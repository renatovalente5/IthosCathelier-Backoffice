/* ==========================================================================
   Backoffice ithos · cathelier

   Escreve directamente no repositório do site. Cada gravação é UM commit, e
   cada commit dispara a publicação — por isso o botão de gravar é um só, e
   junta tudo o que estiver por gravar.

   Princípios que orientaram cada ecrã:
     · Quem usa isto não sabe o que é um commit, um JSON ou um ramo. Nada disso
       aparece em lado nenhum.
     · Nada se grava sozinho. Ela decide quando.
     · Sair com alterações por gravar tem de avisar.
     · Uma fotografia de 14 MB tem de funcionar — reduz-se aqui, antes de subir.
   ========================================================================== */

import { GitHub, ErroGitHub } from './github.js';
import { reduzir, paraBase64, pesoLegivel } from './imagens.js';

const CONFIG = {
  dono: 'renatovalente5',
  repo: 'IthosCathelier',
  ramo: 'main',
  clienteGitHub: '',                                  // preenchido no arranque
  api: 'https://api.ithos-cathelier.pt',
  site: 'https://ithos-cathelier.pt',
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Miniatura de uma fotografia de produto.
 *  Primeiro a derivada publicada (12 KB, em cache); se ainda não existir — foto
 *  acabada de carregar, ou publicação a meio — o original do repositório. */
function miniatura(slug, nome) {
  const base = nome.replace(/\.[^.]+$/, '');
  return {
    src: `${CONFIG.site}/media/ithos/${slug}/${base}-400.webp`,
    alternativa: `https://raw.githubusercontent.com/${CONFIG.dono}/${CONFIG.repo}/${CONFIG.ramo}/_fonte/originais/ithos/${slug}/${nome}`,
  };
}

const estado = {
  gh: null,
  utilizador: null,
  dados: {},
  sujos: new Map(),            // caminho -> {texto} ou {base64} ou {apagar:true}
  aCarregar: false,
};

/* ------------------------------------------------------------- arranque -- */

async function arrancar() {
  try {
    const cfg = await (await fetch('./config.json', { cache: 'no-cache' })).json();
    Object.assign(CONFIG, cfg);
  } catch { /* fica a configuração de origem */ }

  const params = new URLSearchParams(location.search);
  const codigo = params.get('code');
  if (codigo) {
    history.replaceState({}, '', location.pathname);
    await trocarCodigo(codigo);
  }

  const token = sessionStorage.getItem('ic-token');
  if (!token) return mostrarEntrada();

  estado.gh = new GitHub({ token, ...CONFIG });
  try {
    estado.utilizador = await estado.gh.quemSou();
    if (!(await estado.gh.podeEscrever())) {
      return mostrarEntrada('Esta conta do GitHub não tem permissão para editar o site. Fale com quem o fez.');
    }
  } catch (e) {
    sessionStorage.removeItem('ic-token');
    return mostrarEntrada(e.message);
  }

  await carregarTudo();
  window.addEventListener('hashchange', pintar);
  window.addEventListener('beforeunload', (e) => {
    if (estado.sujos.size) { e.preventDefault(); e.returnValue = ''; }
  });
  pintar();
}

async function trocarCodigo(codigo) {
  try {
    const r = await fetch(`${CONFIG.api}/auth/github`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ codigo }),
    });
    const j = await r.json();
    if (j.token) sessionStorage.setItem('ic-token', j.token);
  } catch { /* mostra-se a entrada outra vez */ }
}

function mostrarEntrada(erro = '') {
  const comOAuth = !!CONFIG.clienteGitHub;
  const destino = comOAuth
    ? `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(CONFIG.clienteGitHub)}`
      + `&scope=repo&redirect_uri=${encodeURIComponent(location.origin + location.pathname)}`
    : null;

  document.body.innerHTML = `
<main class="entrada">
  <div class="entrada__caixa">
    <p class="marca marca--grande"><b>ithos</b><i></i>cathelier</p>
    <h1>Gerir a loja</h1>
    ${erro ? `<p class="erro">${esc(erro)}</p>` : ''}
    ${comOAuth
      ? `<p>Entre com a sua conta do GitHub para editar os produtos, os textos e as fotografias.</p>
         <a class="botao botao--largo" href="${esc(destino)}">Entrar com o GitHub</a>`
      : `<p>Cole aqui a chave de acesso que lhe deram. Fica guardada só nesta janela — se
           fechar o browser, tem de a colar outra vez.</p>
         <form id="form-token">
           <label for="token">Chave de acesso</label>
           <input type="password" id="token" autocomplete="off" spellcheck="false"
                  placeholder="ghp_… ou github_pat_…" required>
           <button class="botao botao--largo" type="submit">Entrar</button>
         </form>`}
    <p class="entrada__nota">Em caso de dúvida, fale com quem fez o site.</p>
  </div>
</main>`;

  $('#form-token')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $('#token').value.trim();
    if (!t) return;
    sessionStorage.setItem('ic-token', t);
    location.reload();
  });
}

/* --------------------------------------------------------------- dados --- */

async function carregarTudo() {
  document.body.innerHTML = '<main class="carregando"><p>A abrir a loja…</p></main>';
  const gh = estado.gh;

  const [identidade, fiscal, portes, loja, marcas, categorias, perguntas] = await Promise.all([
    gh.lerJson('conteudo/definicoes/identidade.json'),
    gh.lerJson('conteudo/definicoes/fiscal.json'),
    gh.lerJson('conteudo/definicoes/portes.json'),
    gh.lerJson('conteudo/definicoes/loja.json'),
    gh.lerJson('conteudo/definicoes/marcas.json'),
    gh.lerJson('conteudo/cathelier/categorias.json'),
    gh.lerJson('conteudo/paginas/perguntas.json'),
  ]);

  const listaProdutos = await gh.listar('conteudo/ithos');
  const produtos = {};
  await Promise.all(listaProdutos
    .filter((f) => f.name.endsWith('.json'))
    .map(async (f) => {
      const { dados } = await gh.lerJson(f.path);
      produtos[f.name.slice(0, -5)] = dados;
    }));

  const paginas = {};
  for (const p of await gh.listar('conteudo/paginas')) {
    if (p.name.endsWith('.md')) paginas[p.name.slice(0, -3)] = (await gh.lerTexto(p.path)).texto;
  }

  // Que fotografias existem por produto — para as poder ordenar e apagar.
  const fotos = {};
  for (const slug of Object.keys(produtos)) {
    fotos[slug] = (await gh.listar(`_fonte/originais/ithos/${slug}`))
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f.name))
      .map((f) => f.name);
  }

  estado.dados = {
    identidade: identidade.dados,
    fiscal: fiscal.dados,
    portes: portes.dados,
    loja: loja.dados,
    marcas: marcas.dados,
    categorias: categorias.dados,
    perguntas: perguntas.dados,
    produtos,
    paginas,
    fotos,
  };
}

function marcarSujo(caminho, conteudo) {
  estado.sujos.set(caminho, conteudo);
  actualizarBotaoGravar();
}

function gravarJson(caminho, objecto) {
  marcarSujo(caminho, { texto: `${JSON.stringify(objecto, null, 2)}\n` });
}

function actualizarBotaoGravar() {
  const b = $('[data-gravar]');
  if (!b) return;
  const n = estado.sujos.size;
  b.textContent = n ? `Gravar alterações (${n})` : 'Nada por gravar';
  b.disabled = !n;
  b.classList.toggle('botao--activo', n > 0);
}

async function gravar() {
  if (!estado.sujos.size) return;
  const botao = $('[data-gravar]');
  const antes = botao.textContent;
  botao.disabled = true;
  botao.textContent = 'A gravar…';
  try {
    const ficheiros = [...estado.sujos.entries()].map(([caminho, c]) => ({ caminho, ...c }));
    const quantos = ficheiros.length;
    await estado.gh.gravar(ficheiros, `Alterações do backoffice (${quantos} ficheiro${quantos > 1 ? 's' : ''})`);
    estado.sujos.clear();
    avisar('Gravado. O site atualiza-se dentro de dois a três minutos.', 'bom');
  } catch (e) {
    avisar(e.message || 'Não consegui gravar. Tente outra vez.', 'mau');
  } finally {
    botao.textContent = antes;
    actualizarBotaoGravar();
  }
}

function avisar(texto, tipo = 'bom') {
  const caixa = $('[data-avisos]');
  if (!caixa) return alert(texto);
  const el = document.createElement('div');
  el.className = `aviso aviso--${tipo}`;
  el.setAttribute('role', 'status');
  el.textContent = texto;
  caixa.appendChild(el);
  setTimeout(() => el.remove(), tipo === 'mau' ? 12000 : 6000);
}

/* -------------------------------------------------------------- ecrãs ---- */

const ECRAS = [
  ['produtos', 'Candeeiros', 'As peças da ithos: preços, fotografias, stock'],
  ['ocasioes', 'Ocasiões', 'As categorias da cathelier'],
  ['textos', 'Textos', 'As páginas escritas e as perguntas frequentes'],
  ['loja', 'Loja', 'Prazos, portes, campanhas e avisos'],
  ['dados', 'Os seus dados', 'Nome, morada, contactos — aparecem nas páginas legais'],
  ['publicar', 'Publicação', 'Ver se o site já saiu'],
];

function pintar() {
  const ecra = (location.hash.slice(2) || 'produtos').split('/');
  document.body.innerHTML = `
<header class="topo">
  <a class="topo__marca" href="#/produtos"><span class="marca"><b>ithos</b><i></i>cathelier</span></a>
  <nav class="topo__menu">
    ${ECRAS.map(([id, nome]) => `<a href="#/${id}" ${ecra[0] === id ? 'aria-current="page"' : ''}>${esc(nome)}</a>`).join('')}
  </nav>
  <div class="topo__fim">
    <button class="botao botao--gravar" data-gravar type="button">Nada por gravar</button>
    <button class="botao botao--texto" data-sair type="button">Sair</button>
  </div>
</header>
<div class="avisos" data-avisos></div>
<main id="principal"></main>`;

  $('[data-gravar]').addEventListener('click', gravar);
  $('[data-sair]').addEventListener('click', () => {
    if (estado.sujos.size && !confirm('Tem alterações por gravar. Sair mesmo assim?')) return;
    sessionStorage.removeItem('ic-token');
    location.reload();
  });
  actualizarBotaoGravar();

  const alvo = $('#principal');
  ({
    produtos: () => (ecra[1] ? ecraProduto(alvo, ecra[1]) : ecraProdutos(alvo)),
    ocasioes: () => ecraOcasioes(alvo),
    textos: () => ecraTextos(alvo),
    loja: () => ecraLoja(alvo),
    dados: () => ecraDados(alvo),
    publicar: () => ecraPublicar(alvo),
  }[ecra[0]] ?? (() => ecraProdutos(alvo)))();
}

/* ----------------------------------------------------------- produtos ---- */

function ecraProdutos(alvo) {
  const ps = Object.entries(estado.dados.produtos)
    .sort((a, b) => (a[1].ordem ?? 999) - (b[1].ordem ?? 999));
  const semPreco = ps.filter(([, p]) => !(p.preco > 0));

  alvo.innerHTML = `
<div class="pagina">
  <div class="pagina__cabeca">
    <div>
      <h1>Candeeiros</h1>
      <p class="discreto">${ps.length} peças · ${ps.filter(([, p]) => p.publicado).length} no site</p>
    </div>
    <button class="botao" type="button" data-novo>Novo candeeiro</button>
  </div>

  ${semPreco.length ? `<div class="caixa caixa--aviso">
    <strong>${semPreco.length} ${semPreco.length === 1 ? 'peça está' : 'peças estão'} sem preço</strong> e por isso não ${semPreco.length === 1 ? 'aparece' : 'aparecem'} no site:
    ${semPreco.map(([s, p]) => `<a href="#/produtos/${esc(s)}">${esc(p.nome)}</a>`).join(', ')}.
  </div>` : ''}

  <div class="grelha-cartoes">
    ${ps.map(([slug, p]) => {
      const foto = (estado.dados.fotos[slug] ?? [])[0];
      return `<a class="cartao" href="#/produtos/${esc(slug)}">
        <div class="cartao__foto">
          ${foto ? (() => { const m = miniatura(slug, foto); return `<img src="${esc(m.src)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${esc(m.alternativa)}'">`; })()
            : '<span class="cartao__sem-foto">sem fotografia</span>'}
          ${!p.publicado ? '<span class="selo selo--oculto">Não aparece no site</span>' : ''}
          ${p.estado === 'esgotado' ? '<span class="selo selo--esgotado">Esgotado</span>' : ''}
        </div>
        <div class="cartao__corpo">
          <strong>${esc(p.nome)}</strong>
          <span class="discreto">${p.preco > 0 ? `${p.preco} €` : 'sem preço'}</span>
        </div>
      </a>`;
    }).join('')}
  </div>
</div>`;

  $('[data-novo]').addEventListener('click', () => {
    const nome = prompt('Como se chama o candeeiro novo?');
    if (!nome?.trim()) return;
    const slug = nome.trim().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (estado.dados.produtos[slug]) return avisar('Já existe uma peça com esse nome.', 'mau');
    const modelo = Object.values(estado.dados.produtos)[0];
    estado.dados.produtos[slug] = {
      nome: nome.trim(), preco: null, publicado: false, destaque: false,
      ordem: Math.max(0, ...Object.values(estado.dados.produtos).map((p) => p.ordem ?? 0)) + 10,
      estado: 'por_encomenda', medidas: {}, resumo: '', texto: '',
      opcoes: JSON.parse(JSON.stringify(modelo?.opcoes ?? [])),
      fotos: [], durabilidade: '', reparabilidade: '',
      gpsr: { tipo: `ITH-${slug.slice(0, 3).toUpperCase()}`, lote: '', avisos: [] },
      conformidade: { ce: false, declaracao: '' },
      seo: { titulo: '', descricao: '' },
    };
    estado.dados.fotos[slug] = [];
    gravarJson(`conteudo/ithos/${slug}.json`, estado.dados.produtos[slug]);
    location.hash = `#/produtos/${slug}`;
  });
}

function ecraProduto(alvo, slug) {
  const p = estado.dados.produtos[slug];
  if (!p) { alvo.innerHTML = '<div class="pagina"><p>Não encontrei essa peça.</p></div>'; return; }
  const caminho = `conteudo/ithos/${slug}.json`;
  const guardar = () => gravarJson(caminho, p);

  alvo.innerHTML = `
<div class="pagina pagina--estreita">
  <p><a class="voltar" href="#/produtos">← Todos os candeeiros</a></p>
  <div class="pagina__cabeca">
    <h1>${esc(p.nome)}</h1>
    <a class="botao botao--texto" href="${CONFIG.site}/ithos/candeeiros/${esc(slug)}/" target="_blank" rel="noopener">Ver no site ↗</a>
  </div>

  <section class="bloco">
    <h2>O essencial</h2>
    ${campoTexto('nome', 'Nome', p.nome, 'É o que aparece no site e nos resultados da Google.')}
    ${campoNumero('preco', 'Preço em euros', p.preco, 'Sem preço, a peça não pode aparecer no site.')}
    ${campoTexto('resumo', 'Uma linha sobre a peça', p.resumo, 'Aparece por baixo do nome na montra. Curta.')}
    ${campoLongo('texto', 'Descrição', p.texto, 'Dois ou três parágrafos. Deixe uma linha em branco entre eles.')}
  </section>

  <section class="bloco">
    <h2>Medidas</h2>
    <div class="linha-campos">
      ${campoNumero('medidas.altura', 'Altura (cm)', p.medidas?.altura)}
      ${campoNumero('medidas.largura', 'Largura (cm)', p.medidas?.largura)}
      ${campoNumero('medidas.comprimento', 'Comprimento (cm)', p.medidas?.comprimento)}
      ${campoNumero('medidas.profundidade', 'Profundidade (cm)', p.medidas?.profundidade)}
    </div>
  </section>

  <section class="bloco">
    <h2>No site</h2>
    ${campoInterruptor('publicado', 'Aparece no site', p.publicado, 'Desligue para esconder sem apagar.')}
    ${campoInterruptor('destaque', 'Mostrar na página inicial da ithos', p.destaque)}
    ${campoEscolha('estado', 'Disponibilidade', p.estado, [
      ['em_stock', 'Em stock — sai em 3 dias úteis'],
      ['por_encomenda', 'Por encomenda — até 20 dias úteis'],
      ['esgotado', 'Esgotado — não se pode comprar'],
    ])}
    ${campoNumero('ordem', 'Ordem na montra', p.ordem, 'Número mais baixo aparece primeiro.')}
  </section>

  <section class="bloco">
    <h2>Fotografias</h2>
    <p class="ajuda">A primeira é a capa — é a que aparece na montra e quando alguém partilha a peça.
      Arraste para trocar a ordem. As fotografias são reduzidas automaticamente antes de subirem.</p>
    <div class="fotos" data-fotos></div>
    <label class="botao botao--vazio" style="margin-top:1rem">
      Juntar fotografias
      <input type="file" accept="image/*" multiple hidden data-carregar-fotos>
    </label>
    <p class="ajuda" data-estado-fotos></p>
  </section>

  <section class="bloco">
    <h2>Opções de compra</h2>
    <p class="ajuda">O que o cliente escolhe antes de juntar ao carrinho. Um campo de texto livre
      (como a gravação) torna a peça <strong>personalizada</strong>: deixa de ter direito a devolução
      em 14 dias, e o site avisa disso sozinho.</p>
    <div data-opcoes></div>
  </section>

  <section class="bloco">
    <h2>Segurança e conformidade</h2>
    <p class="ajuda">Obrigatório por lei em cada peça vendida online (Regulamento (UE) 2023/988).
      O tipo e o lote aparecem na ficha, para se poder identificar a peça.</p>
    ${campoTexto('gpsr.tipo', 'Referência do modelo', p.gpsr?.tipo, 'Ex.: ITH-RAP')}
    ${campoTexto('gpsr.lote', 'Lote de produção', p.gpsr?.lote, 'Ex.: 2026-04')}
    ${campoInterruptor('conformidade.ce', 'Tem declaração de conformidade CE', p.conformidade?.ce,
      'Ligue só quando a declaração existir mesmo. O site não a inventa.')}
    ${campoTexto('conformidade.declaracao', 'Referência da declaração', p.conformidade?.declaracao)}
    ${campoLongo('gpsr.avisos', 'Avisos próprios desta peça (um por linha)',
      (p.gpsr?.avisos ?? []).join('\n'),
      'Se deixar vazio, usam-se os avisos gerais definidos em «Loja».')}
  </section>

  <section class="bloco">
    <h2>Google</h2>
    ${campoTexto('seo.titulo', 'Título nos resultados', p.seo?.titulo, 'Vazio = o site escreve um sozinho.')}
    ${campoLongo('seo.descricao', 'Descrição nos resultados', p.seo?.descricao, 'Duas linhas, no máximo.')}
  </section>

  <section class="bloco bloco--perigo">
    <h2>Apagar</h2>
    <p class="ajuda">Apaga a peça e as fotografias. Não há volta atrás. Para a esconder sem apagar,
      desligue o «Aparece no site».</p>
    <button class="botao botao--perigo" type="button" data-apagar>Apagar ${esc(p.nome)}</button>
  </section>
</div>`;

  ligarCampos(alvo, p, guardar, () => {
    // O nome muda o título do ecrã; a disponibilidade muda a etiqueta.
    const h1 = $('.pagina__cabeca h1', alvo);
    if (h1) h1.textContent = p.nome;
  });

  pintarFotos(alvo, slug, p, guardar);
  pintarOpcoes(alvo, p, guardar);

  $('[data-apagar]').addEventListener('click', () => {
    if (!confirm(`Apagar «${p.nome}» e as suas fotografias? Não há volta atrás.`)) return;
    marcarSujo(caminho, { apagar: true });
    for (const f of estado.dados.fotos[slug] ?? []) {
      marcarSujo(`_fonte/originais/ithos/${slug}/${f}`, { apagar: true });
    }
    delete estado.dados.produtos[slug];
    delete estado.dados.fotos[slug];
    location.hash = '#/produtos';
    avisar('Peça marcada para apagar. Carregue em «Gravar alterações» para confirmar.', 'mau');
  });
}

function pintarFotos(alvo, slug, p, guardar) {
  const caixa = $('[data-fotos]', alvo);
  const nomes = estado.dados.fotos[slug] ?? [];

  const desenhar = () => {
    caixa.innerHTML = nomes.length ? nomes.map((n, i) => `
      <figure class="foto" draggable="true" data-indice="${i}">
        ${novas.has(n)
          ? `<img src="${novas.get(n)}" alt="">`
          : (() => { const m = miniatura(slug, n); return `<img src="${esc(m.src)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${esc(m.alternativa)}'">`; })()}
        ${i === 0 ? '<figcaption class="foto__capa">Capa</figcaption>' : ''}
        <button class="foto__tirar" type="button" data-tirar="${i}" aria-label="Apagar fotografia ${i + 1}">×</button>
      </figure>`).join('')
      : '<p class="ajuda">Ainda não há fotografias.</p>';
  };
  const novas = new Map();
  desenhar();

  caixa.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tirar]');
    if (!b) return;
    const i = Number(b.dataset.tirar);
    if (!confirm('Apagar esta fotografia?')) return;
    const nome = nomes[i];
    marcarSujo(`_fonte/originais/ithos/${slug}/${nome}`, { apagar: true });
    nomes.splice(i, 1);
    renumerar();
  });

  // Arrastar para reordenar. A ordem é o NOME do ficheiro (01, 02, 03…), por
  // isso reordenar obriga a reescrever os ficheiros — mas é a única ordem que o
  // gerador conhece e a única que ela vê.
  let origem = null;
  caixa.addEventListener('dragstart', (e) => {
    origem = Number(e.target.closest('[data-indice]')?.dataset.indice);
  });
  caixa.addEventListener('dragover', (e) => e.preventDefault());
  caixa.addEventListener('drop', async (e) => {
    e.preventDefault();
    const destino = Number(e.target.closest('[data-indice]')?.dataset.indice);
    if (Number.isNaN(origem) || Number.isNaN(destino) || origem === destino) return;
    const [movida] = nomes.splice(origem, 1);
    nomes.splice(destino, 0, movida);
    await reescreverOrdem();
  });

  async function reescreverOrdem() {
    // Lê os conteúdos actuais e volta a gravá-los com os nomes na ordem nova.
    avisar('A reordenar as fotografias…');
    const conteudos = [];
    for (const n of nomes) {
      if (novas.has(n)) { conteudos.push(novas.get(`base64:${n}`)); continue; }
      const r = await estado.gh.pedir(
        `${estado.gh.base}/contents/${encodeURI(`_fonte/originais/ithos/${slug}/${n}`)}?ref=${CONFIG.ramo}`);
      conteudos.push(r.content.replace(/\n/g, ''));
    }
    for (const n of estado.dados.fotos[slug]) {
      marcarSujo(`_fonte/originais/ithos/${slug}/${n}`, { apagar: true });
    }
    const novosNomes = conteudos.map((_, i) => `${String(i + 1).padStart(2, '0')}.jpg`);
    conteudos.forEach((b64, i) => {
      marcarSujo(`_fonte/originais/ithos/${slug}/${novosNomes[i]}`, { base64: b64 });
    });
    estado.dados.fotos[slug] = novosNomes;
    nomes.length = 0;
    nomes.push(...novosNomes);
    p.fotos = novosNomes.map((n) => n.replace(/\.[^.]+$/, ''));
    guardar();
    desenhar();
  }

  function renumerar() {
    p.fotos = nomes.map((n) => n.replace(/\.[^.]+$/, ''));
    guardar();
    desenhar();
  }

  $('[data-carregar-fotos]', alvo).addEventListener('change', async (e) => {
    const ficheiros = [...e.target.files];
    e.target.value = '';
    if (!ficheiros.length) return;
    const nota = $('[data-estado-fotos]', alvo);
    let i = 0;
    for (const f of ficheiros) {
      i++;
      nota.textContent = `A preparar ${i} de ${ficheiros.length}: ${f.name}…`;
      try {
        const r = await reduzir(f);
        const b64 = await paraBase64(r.blob);
        const proximo = `${String(nomes.length + 1).padStart(2, '0')}.jpg`;
        marcarSujo(`_fonte/originais/ithos/${slug}/${proximo}`, { base64: b64 });
        novas.set(proximo, URL.createObjectURL(r.blob));
        novas.set(`base64:${proximo}`, b64);
        nomes.push(proximo);
        nota.textContent = `${f.name}: ${r.original.largura}×${r.original.altura}, ${pesoLegivel(r.original.bytes)} → ${r.largura}×${r.altura}, ${pesoLegivel(r.blob.size)}`;
      } catch (erro) {
        avisar(erro.message || `Não consegui ler ${f.name}.`, 'mau');
      }
    }
    renumerar();
  });
}

function pintarOpcoes(alvo, p, guardar) {
  const caixa = $('[data-opcoes]', alvo);
  const desenhar = () => {
    caixa.innerHTML = (p.opcoes ?? []).map((o, i) => `
<div class="opcao" data-opcao="${i}">
  <div class="opcao__cabeca">
    <strong>${esc(o.nome)}</strong>
    <span class="etiqueta">${o.tipo === 'escolha' ? 'escolha' : 'texto livre'}</span>
    ${o.personaliza ? '<span class="etiqueta etiqueta--aviso">torna a peça personalizada</span>' : ''}
    <button class="botao botao--texto" type="button" data-tirar-opcao="${i}">Tirar</button>
  </div>
  ${o.tipo === 'escolha'
    ? `<ul class="opcao__valores">${(o.valores ?? []).map((v) => `<li>${esc(v.nome ?? v)}${v.suplemento ? ` <span class="discreto">+${v.suplemento} €</span>` : ''}</li>`).join('')}</ul>`
    : `<p class="ajuda">Até ${o.max ?? 40} caracteres${o.suplemento ? ` · +${o.suplemento} €` : ''}</p>`}
  <div class="linha-campos">
    <label>Suplemento (€)
      <input type="number" step="0.01" min="0" value="${o.suplemento ?? 0}" data-op-suplemento="${i}">
    </label>
    ${o.tipo !== 'escolha' ? `<label>Máximo de caracteres
      <input type="number" step="1" min="1" max="200" value="${o.max ?? 40}" data-op-max="${i}">
    </label>` : ''}
  </div>
</div>`).join('') || '<p class="ajuda">Sem opções.</p>';
  };
  desenhar();

  caixa.addEventListener('input', (e) => {
    const sup = e.target.dataset.opSuplemento;
    const max = e.target.dataset.opMax;
    if (sup !== undefined) p.opcoes[Number(sup)].suplemento = Number(e.target.value) || 0;
    else if (max !== undefined) p.opcoes[Number(max)].max = Number(e.target.value) || 40;
    else return;
    guardar();
  });
  caixa.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tirar-opcao]');
    if (!b) return;
    const i = Number(b.dataset.tirarOpcao);
    if (!confirm(`Tirar a opção «${p.opcoes[i].nome}»?`)) return;
    p.opcoes.splice(i, 1);
    guardar();
    desenhar();
  });
}

/* ----------------------------------------------------------- ocasiões ---- */

function ecraOcasioes(alvo) {
  const cats = estado.dados.categorias;
  const guardar = () => gravarJson('conteudo/cathelier/categorias.json', cats);

  alvo.innerHTML = `
<div class="pagina pagina--estreita">
  <h1>Ocasiões da cathelier</h1>
  <p class="discreto">Cada ocasião é uma página do site, com um pedido de orçamento próprio.</p>
  ${cats.map((c, i) => `
  <section class="bloco" data-cat="${i}">
    <div class="pagina__cabeca">
      <h2>${esc(c.nome)}</h2>
      <a class="botao botao--texto" href="${CONFIG.site}/cathelier/${esc(c.slug)}/" target="_blank" rel="noopener">Ver ↗</a>
    </div>
    ${campoTexto(`c${i}.nome`, 'Nome', c.nome)}
    ${campoTexto(`c${i}.resumo`, 'Uma linha', c.resumo)}
    ${campoLongo(`c${i}.texto`, 'Texto da página', c.texto)}
    ${campoLongo(`c${i}.tipos`, 'Que peças faz para esta ocasião (uma por linha)', (c.tipos ?? []).join('\n'))}
    ${campoInterruptor(`c${i}.publicado`, 'Aparece no site', c.publicado)}
    ${campoNumero(`c${i}.ordem`, 'Ordem', c.ordem)}
  </section>`).join('')}
</div>`;

  const tratarCat = (e) => {
    const m = /^c(\d+)\.(.+)$/.exec(e.target.dataset.campo ?? '');
    if (!m) return;
    const c = cats[Number(m[1])];
    const chave = m[2];
    if (chave === 'tipos') c.tipos = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
    else if (chave === 'publicado') c.publicado = e.target.checked;
    else if (chave === 'ordem') c.ordem = Number(e.target.value) || 0;
    else c[chave] = e.target.value;
    guardar();
  };
  alvo.addEventListener('input', tratarCat);
  alvo.addEventListener('change', (e) => {
    if (e.target.type === 'checkbox') tratarCat(e);
  });
}

/* ------------------------------------------------------------- textos ---- */

const PAGINAS_EDITAVEIS = [
  ['sobre', 'O ateliê', 'A página que conta a história das duas marcas.'],
  ['contactos', 'Contactos', 'Como falar consigo.'],
  ['como-e-feito', 'Como é feito um ithos', 'As etapas de fabrico.'],
  ['cuidados-e-seguranca', 'Cuidados e segurança', 'Avisos, pilhas, limpeza. Esta página é obrigatória por lei.'],
  ['como-trabalhamos', 'Como trabalhamos (cathelier)', 'Do pedido à entrega.'],
];

function ecraTextos(alvo) {
  alvo.innerHTML = `
<div class="pagina pagina--estreita">
  <h1>Textos</h1>
  <p class="discreto">Pode usar <strong>**negrito**</strong>, títulos com <code>## </code> e listas com <code>- </code>.
    Deixe uma linha em branco entre parágrafos.</p>

  ${PAGINAS_EDITAVEIS.map(([chave, nome, ajuda]) => `
  <section class="bloco">
    <h2>${esc(nome)}</h2>
    <p class="ajuda">${esc(ajuda)}</p>
    <textarea rows="14" data-pagina="${chave}">${esc(estado.dados.paginas[chave] ?? '')}</textarea>
  </section>`).join('')}

  <section class="bloco">
    <h2>Marcas — o que aparece nas páginas iniciais</h2>
    ${['ithos', 'cathelier'].map((m) => `
      <h3>${m}</h3>
      ${campoTexto(`m.${m}.hero_titulo`, 'Título grande', estado.dados.marcas[m].hero_titulo)}
      ${campoLongo(`m.${m}.hero_texto`, 'Texto por baixo', estado.dados.marcas[m].hero_texto)}
      ${campoTexto(`m.${m}.sobre_titulo`, 'Título do «sobre»', estado.dados.marcas[m].sobre_titulo)}
      ${campoLongo(`m.${m}.sobre_texto`, 'Texto do «sobre»', estado.dados.marcas[m].sobre_texto)}
    `).join('')}
  </section>

  <section class="bloco">
    <h2>Perguntas frequentes</h2>
    <p class="ajuda">Aparecem na página de perguntas e a Google mostra-as às vezes nos resultados.</p>
    <div data-perguntas></div>
    <button class="botao botao--vazio" type="button" data-nova-pergunta>Nova pergunta</button>
  </section>
</div>`;

  alvo.addEventListener('input', (e) => {
    const pag = e.target.dataset.pagina;
    if (pag) {
      estado.dados.paginas[pag] = e.target.value;
      marcarSujo(`conteudo/paginas/${pag}.md`, { texto: e.target.value });
      return;
    }
    const m = /^m\.(ithos|cathelier)\.(.+)$/.exec(e.target.dataset.campo ?? '');
    if (m) {
      estado.dados.marcas[m[1]][m[2]] = e.target.value;
      gravarJson('conteudo/definicoes/marcas.json', estado.dados.marcas);
    }
  });

  const caixaP = $('[data-perguntas]', alvo);
  const desenharPerguntas = () => {
    caixaP.innerHTML = estado.dados.perguntas.map((q, i) => `
      <div class="pergunta-editar">
        ${campoTexto(`q${i}.pergunta`, `Pergunta ${i + 1}`, q.pergunta)}
        ${campoLongo(`q${i}.resposta`, 'Resposta', q.resposta)}
        <button class="botao botao--texto" type="button" data-tirar-pergunta="${i}">Tirar esta pergunta</button>
      </div>`).join('');
  };
  desenharPerguntas();

  caixaP.addEventListener('input', (e) => {
    const m = /^q(\d+)\.(pergunta|resposta)$/.exec(e.target.dataset.campo ?? '');
    if (!m) return;
    estado.dados.perguntas[Number(m[1])][m[2]] = e.target.value;
    gravarJson('conteudo/paginas/perguntas.json', estado.dados.perguntas);
  });
  caixaP.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tirar-pergunta]');
    if (!b) return;
    if (!confirm('Tirar esta pergunta?')) return;
    estado.dados.perguntas.splice(Number(b.dataset.tirarPergunta), 1);
    gravarJson('conteudo/paginas/perguntas.json', estado.dados.perguntas);
    desenharPerguntas();
  });
  $('[data-nova-pergunta]', alvo).addEventListener('click', () => {
    estado.dados.perguntas.push({ pergunta: '', resposta: '' });
    gravarJson('conteudo/paginas/perguntas.json', estado.dados.perguntas);
    desenharPerguntas();
  });
}

/* --------------------------------------------------------------- loja ---- */

function ecraLoja(alvo) {
  const { loja, portes, fiscal } = estado.dados;
  const gLoja = () => gravarJson('conteudo/definicoes/loja.json', loja);
  const gPortes = () => gravarJson('conteudo/definicoes/portes.json', portes);
  const gFiscal = () => gravarJson('conteudo/definicoes/fiscal.json', fiscal);

  const PAISES = {
    PT: 'Portugal (continente e ilhas)', ES: 'Espanha', FR: 'França', GB: 'Reino Unido',
    DE: 'Alemanha', CH: 'Suíça', BE: 'Bélgica', NL: 'Países Baixos', IT: 'Itália',
    IE: 'Irlanda', AT: 'Áustria', LU: 'Luxemburgo',
  };

  alvo.innerHTML = `
<div class="pagina pagina--estreita">
  <h1>A loja</h1>

  <section class="bloco">
    <h2>Aviso no topo do site</h2>
    <p class="ajuda">Para dizer que está de férias, que as encomendas de Natal fecham num dia,
      ou o que precisar. Aparece em todas as páginas.</p>
    ${campoInterruptor('loja.aviso.ativo', 'Mostrar aviso', loja.aviso?.ativo)}
    ${campoTexto('loja.aviso.texto', 'Texto do aviso', loja.aviso?.texto)}
  </section>

  <section class="bloco">
    <h2>Prazos</h2>
    ${campoNumero('loja.prazos.expedicao_em_stock_dias', 'Dias úteis para expedir o que está em stock', loja.prazos.expedicao_em_stock_dias)}
    ${campoNumero('loja.prazos.producao_dias', 'Dias úteis para produzir o que é por encomenda', loja.prazos.producao_dias)}
    <p class="ajuda">Estes prazos aparecem em cada peça, no carrinho e no email de confirmação.
      A lei não deixa entregar depois de 30 dias sem o cliente aceitar expressamente.</p>
    ${campoTexto('loja.prazos.texto_em_stock', 'Frase para «em stock»', loja.prazos.texto_em_stock)}
    ${campoTexto('loja.prazos.texto_por_encomenda', 'Frase para «por encomenda»', loja.prazos.texto_por_encomenda)}
    ${campoTexto('loja.prazos.texto_esgotado', 'Frase para «esgotado»', loja.prazos.texto_esgotado)}
  </section>

  <section class="bloco">
    <h2>Para onde envia</h2>
    <p class="ajuda">Só os países ligados aparecem no carrinho. <strong>Antes de ligar um país novo,
      fale com a contabilista:</strong> vender para fora da União Europeia faz perder a isenção de IVA
      do artigo 53.º, e cada país tem registos de embalagens e pilhas próprios.</p>
    <div class="paises">
      ${Object.entries(PAISES).map(([c, n]) => `
        <label class="pais">
          <input type="checkbox" data-pais="${c}" ${portes.ativos.includes(c) ? 'checked' : ''}>
          <span>${esc(n)}</span>
        </label>`).join('')}
    </div>
  </section>

  <section class="bloco">
    <h2>Portes</h2>
    ${portes.zonas.map((z, i) => `
      <div class="linha-campos">
        <label>${esc(z.nome)} — preço (€)
          <input type="number" step="0.5" min="0" value="${z.preco}" data-zona-preco="${i}">
        </label>
        <label>Mínimo (dias)
          <input type="number" step="1" min="1" value="${z.dias_min}" data-zona-min="${i}">
        </label>
        <label>Máximo (dias)
          <input type="number" step="1" min="1" value="${z.dias_max}" data-zona-max="${i}">
        </label>
      </div>`).join('')}
  </section>

  <section class="bloco">
    <h2>Campanha de portes grátis</h2>
    ${campoInterruptor('portes.campanha.ativa', 'Campanha a decorrer', portes.campanha?.ativa)}
    ${campoNumero('portes.campanha.portes_gratis_acima', 'Portes grátis acima de (€)', portes.campanha?.portes_gratis_acima)}
    ${campoTexto('portes.campanha.titulo', 'Como se chama a campanha', portes.campanha?.titulo)}
    <p class="ajuda">Se fizer descontos de preço, a lei obriga a mostrar o preço mais baixo dos
      últimos 30 dias. Portes grátis não são desconto de preço, por isso esta campanha é segura.</p>
  </section>

  <section class="bloco">
    <h2>Devoluções e garantia</h2>
    ${campoNumero('loja.devolucoes.dias_livre_resolucao', 'Dias para devolver sem explicação', loja.devolucoes.dias_livre_resolucao, 'A lei diz 14. Pode dar mais, nunca menos.')}
    ${campoNumero('loja.devolucoes.garantia_anos', 'Anos de garantia', loja.devolucoes.garantia_anos, 'A lei diz 3.')}
    ${campoTexto('loja.devolucoes.morada_devolucao', 'Morada para devoluções', loja.devolucoes.morada_devolucao, 'Se ficar vazio, usa-se a morada da empresa.')}
  </section>

  <section class="bloco">
    <h2>Avisos de segurança dos candeeiros</h2>
    <p class="ajuda">Aparecem em todas as peças que não tenham avisos próprios. São obrigatórios
      (Regulamento (UE) 2023/988). Um por linha.</p>
    ${campoLongo('loja.avisos_seguranca_ithos', '', (loja.avisos_seguranca_ithos ?? []).join('\n'))}
  </section>

  <section class="bloco">
    <h2>IVA</h2>
    ${campoEscolha('fiscal.regime', 'Regime', fiscal.regime, [
      ['isento_art53', 'Isento — artigo 53.º do CIVA (sem IVA nas faturas)'],
      ['normal', 'Regime normal — com IVA'],
    ], 'Só mude isto depois de falar com a contabilista. Muda o que se escreve em todas as páginas.')}
  </section>
</div>`;

  const tratarLoja = (e) => {
    const c = e.target.dataset.campo;
    if (c?.startsWith('loja.')) {
      const chave = c.slice(5);
      if (chave === 'avisos_seguranca_ithos') {
        loja.avisos_seguranca_ithos = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
      } else porFundo(loja, chave, valorDe(e.target));
      gLoja();
    } else if (c?.startsWith('portes.')) {
      porFundo(portes, c.slice(7), valorDe(e.target));
      gPortes();
    } else if (c?.startsWith('fiscal.')) {
      porFundo(fiscal, c.slice(7), valorDe(e.target));
      if (fiscal.regime === 'isento_art53') {
        fiscal.mencao_fatura = 'IVA — regime de isenção, artigo 53.º do CIVA';
        fiscal.iva_taxa = 0;
      } else {
        fiscal.mencao_fatura = '';
        fiscal.iva_taxa = 23;
      }
      gFiscal();
    } else if (e.target.dataset.pais !== undefined) {
      const p = e.target.dataset.pais;
      portes.ativos = e.target.checked
        ? [...new Set([...portes.ativos, p])]
        : portes.ativos.filter((x) => x !== p);
      if (!portes.ativos.length) {
        e.target.checked = true;
        portes.ativos = [p];
        avisar('Tem de haver pelo menos um país — senão ninguém consegue comprar.', 'mau');
      }
      gPortes();
    } else {
      const zp = e.target.dataset.zonaPreco;
      const zi = e.target.dataset.zonaMin;
      const za = e.target.dataset.zonaMax;
      if (zp !== undefined) portes.zonas[Number(zp)].preco = Number(e.target.value) || 0;
      else if (zi !== undefined) portes.zonas[Number(zi)].dias_min = Number(e.target.value) || 1;
      else if (za !== undefined) portes.zonas[Number(za)].dias_max = Number(e.target.value) || 1;
      else return;
      gPortes();
    }
  };
  alvo.addEventListener('input', tratarLoja);
  alvo.addEventListener('change', (e) => {
    if (e.target.type === 'checkbox' || e.target.tagName === 'SELECT') tratarLoja(e);
  });
}

/* ------------------------------------------------------------- dados ----- */

function ecraDados(alvo) {
  const i = estado.dados.identidade;
  const guardar = () => gravarJson('conteudo/definicoes/identidade.json', i);
  // Os nomes internos dos campos não se mostram: «codigo_postal» não é
  // português, e quem lê isto quer saber o que falta, não como se chama a chave.
  const NOMES = {
    nome: 'nome completo', nif: 'NIF', email: 'email', telefone: 'telefone',
    morada: 'morada', codigo_postal: 'código postal', localidade: 'localidade',
  };
  const falta = Object.keys(NOMES).filter((c) => !String(i[c] ?? '').trim());

  alvo.innerHTML = `
<div class="pagina pagina--estreita">
  <h1>Os seus dados</h1>
  <p class="discreto">Isto aparece no rodapé e nas páginas legais do site. A lei obriga
    (Decreto-Lei 7/2004, artigo 10.º) — e <strong>o site não publica</strong> se faltar alguma coisa.</p>

  ${falta.length ? `<div class="caixa caixa--aviso">
    <strong>Falta preencher:</strong> ${falta.map((f) => esc(NOMES[f])).join(', ')}.
    Enquanto faltar, o site não se atualiza.
  </div>` : '<div class="caixa caixa--bom">Está tudo preenchido.</div>'}

  <section class="bloco">
    <h2>Identificação</h2>
    ${campoTexto('i.nome', 'Nome completo', i.nome)}
    ${campoTexto('i.forma_juridica', 'Forma jurídica', i.forma_juridica)}
    ${campoTexto('i.nif', 'NIF', i.nif)}
  </section>

  <section class="bloco">
    <h2>Morada</h2>
    <p class="ajuda">Tem de ser a morada real da atividade. É para aqui que os clientes devolvem
      as peças, e é o que a fiscalização verifica.</p>
    ${campoTexto('i.morada', 'Rua e número', i.morada)}
    <div class="linha-campos">
      ${campoTexto('i.codigo_postal', 'Código postal', i.codigo_postal)}
      ${campoTexto('i.localidade', 'Localidade', i.localidade)}
    </div>
  </section>

  <section class="bloco">
    <h2>Contactos</h2>
    ${campoTexto('i.email', 'Email', i.email)}
    ${campoTexto('i.telefone', 'Telefone (com +351)', i.telefone)}
    ${campoTexto('i.telefone_texto', 'Telefone como aparece escrito', i.telefone_texto)}
    ${campoTexto('i.whatsapp', 'WhatsApp (só números, com 351)', i.whatsapp)}
  </section>

  <section class="bloco">
    <h2>Redes sociais</h2>
    ${campoTexto('i.instagram_ithos', 'Instagram da ithos', i.instagram_ithos)}
    ${campoTexto('i.facebook_ithos', 'Facebook da ithos', i.facebook_ithos)}
    ${campoTexto('i.instagram_cathelier', 'Instagram da cathelier', i.instagram_cathelier)}
  </section>
</div>`;

  alvo.addEventListener('input', (e) => {
    const c = e.target.dataset.campo;
    if (!c?.startsWith('i.')) return;
    porFundo(i, c.slice(2), e.target.value);
    guardar();
  });
}

/* ---------------------------------------------------------- publicar ----- */

async function ecraPublicar(alvo) {
  alvo.innerHTML = `
<div class="pagina pagina--estreita">
  <h1>Publicação</h1>
  <p class="discreto">Sempre que grava, o site é reconstruído e publicado sozinho. Demora
    dois a três minutos.</p>
  <p><a class="botao" href="${CONFIG.site}" target="_blank" rel="noopener">Abrir o site ↗</a></p>
  <section class="bloco">
    <h2>Últimas publicações</h2>
    <div data-runs><p class="ajuda">A ver…</p></div>
  </section>
</div>`;

  try {
    const runs = await estado.gh.publicacoes(6);
    $('[data-runs]', alvo).innerHTML = runs.length ? `<ul class="runs">${runs.map((r) => {
      const estadoTexto = r.estado !== 'completed' ? 'a publicar…'
        : r.resultado === 'success' ? 'publicado'
        : 'falhou';
      const classe = r.estado !== 'completed' ? 'a-correr' : r.resultado === 'success' ? 'bom' : 'mau';
      return `<li class="run run--${classe}">
        <span>${esc(new Date(r.quando).toLocaleString('pt-PT'))}</span>
        <span>${esc(r.titulo ?? '')}</span>
        <strong>${estadoTexto}</strong>
        ${r.resultado === 'failure' ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">ver o erro ↗</a>` : ''}
      </li>`;
    }).join('')}</ul>` : '<p class="ajuda">Ainda não houve publicações.</p>';
  } catch (e) {
    $('[data-runs]', alvo).innerHTML = `<p class="ajuda">Não consegui ler o estado: ${esc(e.message)}</p>`;
  }
}

/* -------------------------------------------------------- componentes ---- */

function campoTexto(campo, rotulo, valor, ajuda = '') {
  return `<label class="campo">
    ${rotulo ? `<span>${esc(rotulo)}</span>` : ''}
    <input type="text" value="${esc(valor ?? '')}" data-campo="${esc(campo)}">
    ${ajuda ? `<small class="ajuda">${ajuda}</small>` : ''}
  </label>`;
}

function campoLongo(campo, rotulo, valor, ajuda = '') {
  return `<label class="campo">
    ${rotulo ? `<span>${esc(rotulo)}</span>` : ''}
    <textarea rows="6" data-campo="${esc(campo)}">${esc(valor ?? '')}</textarea>
    ${ajuda ? `<small class="ajuda">${ajuda}</small>` : ''}
  </label>`;
}

function campoNumero(campo, rotulo, valor, ajuda = '') {
  return `<label class="campo">
    <span>${esc(rotulo)}</span>
    <input type="number" step="any" value="${valor ?? ''}" data-campo="${esc(campo)}">
    ${ajuda ? `<small class="ajuda">${ajuda}</small>` : ''}
  </label>`;
}

function campoInterruptor(campo, rotulo, valor, ajuda = '') {
  return `<label class="interruptor">
    <input type="checkbox" ${valor ? 'checked' : ''} data-campo="${esc(campo)}">
    <span>${esc(rotulo)}</span>
    ${ajuda ? `<small class="ajuda">${ajuda}</small>` : ''}
  </label>`;
}

function campoEscolha(campo, rotulo, valor, opcoes, ajuda = '') {
  return `<label class="campo">
    <span>${esc(rotulo)}</span>
    <select data-campo="${esc(campo)}">
      ${opcoes.map(([v, n]) => `<option value="${esc(v)}" ${v === valor ? 'selected' : ''}>${esc(n)}</option>`).join('')}
    </select>
    ${ajuda ? `<small class="ajuda">${ajuda}</small>` : ''}
  </label>`;
}

const valorDe = (el) =>
  (el.type === 'checkbox' ? el.checked : el.type === 'number' ? (Number(el.value) || 0) : el.value);

/** Põe um valor num caminho com pontos: `medidas.altura`. */
function porFundo(objecto, caminho, valor) {
  const partes = caminho.split('.');
  let alvo = objecto;
  for (const p of partes.slice(0, -1)) {
    alvo[p] ??= {};
    alvo = alvo[p];
  }
  const ultima = partes.at(-1);
  if (valor === '' && typeof alvo[ultima] === 'number') alvo[ultima] = null;
  else alvo[ultima] = valor;
}

/** Liga todos os campos simples de um ecrã a um objecto. */
function ligarCampos(alvo, objecto, guardar, depois = () => {}) {
  const tratar = (e) => {
    const campo = e.target.dataset.campo;
    if (!campo) return;
    if (campo === 'gpsr.avisos') {
      objecto.gpsr ??= {};
      objecto.gpsr.avisos = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
    } else {
      porFundo(objecto, campo, valorDe(e.target));
    }
    guardar();
    depois();
  };
  alvo.addEventListener('input', tratar);
  alvo.addEventListener('change', (e) => {
    if (e.target.type === 'checkbox' || e.target.tagName === 'SELECT') tratar(e);
  });
}

/* ------------------------------------------------------------------------ */

arrancar().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<main class="carregando"><p class="erro">Não consegui abrir: ${esc(e.message)}</p>
    <p><button class="botao" onclick="sessionStorage.clear();location.reload()">Tentar outra vez</button></p></main>`;
});
