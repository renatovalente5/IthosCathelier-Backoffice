/* Ler e escrever no repositório do site pela API do GitHub.
 *
 * Grava com a API de dados do Git (blobs → árvore → commit → referência) e não
 * com a API de conteúdos. A diferença importa: a API de conteúdos escreve UM
 * ficheiro por commit, e gravar um produto com seis fotografias novas daria sete
 * commits e sete publicações do site, uma a cancelar a outra. Assim é um commit
 * e uma publicação, por cada vez que ela carrega em «Gravar».
 */

const API = 'https://api.github.com';

export class GitHub {
  constructor({ token, dono, repo, ramo = 'main' }) {
    this.token = token;
    this.dono = dono;
    this.repo = repo;
    this.ramo = ramo;
    this.cache = new Map();
  }

  get base() { return `${API}/repos/${this.dono}/${this.repo}`; }

  async pedir(caminho, opcoes = {}) {
    const r = await fetch(caminho.startsWith('http') ? caminho : `${API}${caminho}`, {
      ...opcoes,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'x-github-api-version': '2022-11-28',
        ...(opcoes.body ? { 'content-type': 'application/json' } : {}),
        ...opcoes.headers,
      },
    });
    if (r.status === 401) throw new ErroGitHub(401, 'A sessão expirou. Volte a entrar.');
    if (r.status === 403 && r.headers.get('x-ratelimit-remaining') === '0') {
      throw new ErroGitHub(403, 'O GitHub travou os pedidos por uns minutos. Espere um pouco e tente outra vez.');
    }
    if (r.status === 404) throw new ErroGitHub(404, 'Não encontrei esse ficheiro no repositório.');
    if (!r.ok) {
      const t = await r.text();
      throw new ErroGitHub(r.status, `O GitHub recusou (${r.status}). ${t.slice(0, 200)}`);
    }
    return r.status === 204 ? null : r.json();
  }

  async quemSou() {
    return this.pedir('/user');
  }

  async podeEscrever() {
    const r = await this.pedir(`/repos/${this.dono}/${this.repo}`);
    return !!(r.permissions?.push || r.permissions?.admin);
  }

  /** Um ficheiro de texto do repositório. */
  async lerTexto(caminho) {
    const r = await this.pedir(`${this.base}/contents/${encodeURI(caminho)}?ref=${this.ramo}`);
    // O conteúdo vem em base64 e pode trazer quebras de linha pelo meio.
    const bytes = Uint8Array.from(atob(r.content.replace(/\n/g, '')), (c) => c.charCodeAt(0));
    return { texto: new TextDecoder().decode(bytes), sha: r.sha };
  }

  async lerJson(caminho) {
    const { texto, sha } = await this.lerTexto(caminho);
    return { dados: JSON.parse(texto), sha };
  }

  /** Nomes dos ficheiros de uma pasta. */
  async listar(caminho) {
    try {
      const r = await this.pedir(`${this.base}/contents/${encodeURI(caminho)}?ref=${this.ramo}`);
      return Array.isArray(r) ? r : [];
    } catch (e) {
      if (e.estado === 404) return [];
      throw e;
    }
  }

  /**
   * Grava vários ficheiros num só commit.
   *
   * @param {Array<{caminho: string, texto?: string, base64?: string, apagar?: boolean}>} ficheiros
   */
  async gravar(ficheiros, mensagem) {
    if (!ficheiros.length) return null;

    const ref = await this.pedir(`${this.base}/git/ref/heads/${this.ramo}`);
    const baseSha = ref.object.sha;
    const commitBase = await this.pedir(`${this.base}/git/commits/${baseSha}`);

    const entradas = [];
    for (const f of ficheiros) {
      if (f.apagar) {
        // Numa árvore, apagar é pôr o sha a null.
        entradas.push({ path: f.caminho, mode: '100644', type: 'blob', sha: null });
        continue;
      }
      const blob = await this.pedir(`${this.base}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify(f.base64 !== undefined
          ? { content: f.base64, encoding: 'base64' }
          : { content: f.texto, encoding: 'utf-8' }),
      });
      entradas.push({ path: f.caminho, mode: '100644', type: 'blob', sha: blob.sha });
    }

    const arvore = await this.pedir(`${this.base}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: commitBase.tree.sha, tree: entradas }),
    });

    const commit = await this.pedir(`${this.base}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message: mensagem, tree: arvore.sha, parents: [baseSha] }),
    });

    try {
      await this.pedir(`${this.base}/git/refs/heads/${this.ramo}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha, force: false }),
      });
    } catch (e) {
      // O ramo mexeu-se debaixo dos pés — outra gravação entretanto, ou a
      // publicação a escrever as fotografias derivadas. Diz-se o que aconteceu
      // em vez de deixar a gravação a falhar sem explicação.
      throw new ErroGitHub(e.estado,
        'Alguém (ou a publicação automática) gravou no mesmo momento. '
        + 'Recarregue a página e volte a gravar — o que escreveu não se perdeu se não fechar esta janela.');
    }

    this.cache.clear();
    return commit.sha;
  }

  /** As últimas publicações, para a cliente ver se o site já saiu. */
  async publicacoes(limite = 5) {
    const r = await this.pedir(`${this.base}/actions/runs?per_page=${limite}&branch=${this.ramo}`);
    return (r.workflow_runs ?? []).map((w) => ({
      estado: w.status,
      resultado: w.conclusion,
      quando: w.created_at,
      titulo: w.display_title,
      url: w.html_url,
    }));
  }
}

export class ErroGitHub extends Error {
  constructor(estado, mensagem) { super(mensagem); this.estado = estado; }
}
