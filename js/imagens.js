/* Reduzir as fotografias ANTES de as enviar.
 *
 * Porque existe: as fotografias saem do telemóvel com 4000 px de lado e vários
 * MB. Enviadas assim, cada gravação carrega dezenas de MB para o repositório, o
 * commit fica gigante e a publicação demora uma eternidade — e há gestores de
 * conteúdos onde isto rebenta com um erro que não explica nada.
 *
 * Aqui a redução é feita no browser, antes de sair do telemóvel: 2000 px de lado
 * maior, JPEG de qualidade 88, com tecto de peso. O original nunca sobe.
 */

const LADO_MAX = 2000;
const TECTO_KB = 900;

/** Lê o ficheiro respeitando a rotação dos metadados. */
async function carregar(ficheiro) {
  // `createImageBitmap` com `imageOrientation: 'from-image'` aplica a rotação
  // EXIF sozinho. Sem isso, as fotografias tiradas na vertical sobem deitadas —
  // e ela não tem como as endireitar.
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(ficheiro, { imageOrientation: 'from-image' });
    } catch { /* cai para o caminho abaixo */ }
  }
  const url = URL.createObjectURL(ficheiro);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // Adiado: revogar já deixava o `img` sem fonte em alguns browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function reduzir(ficheiro) {
  if (!/^image\//.test(ficheiro.type)) {
    throw new Error(`«${ficheiro.name}» não é uma imagem.`);
  }
  const fonte = await carregar(ficheiro);
  const larguraOriginal = fonte.width;
  const alturaOriginal = fonte.height;

  const escala = Math.min(1, LADO_MAX / Math.max(larguraOriginal, alturaOriginal));
  const largura = Math.round(larguraOriginal * escala);
  const altura = Math.round(alturaOriginal * escala);

  const tela = document.createElement('canvas');
  tela.width = largura;
  tela.height = altura;
  const ctx = tela.getContext('2d', { alpha: false });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(fonte, 0, 0, largura, altura);
  if (fonte.close) fonte.close();

  let qualidade = 0.88;
  let blob = await paraBlob(tela, qualidade);
  // Fotografias com muito detalhe (folhagem, verga, tecido) não cabem no tecto à
  // primeira. Baixa-se só a qualidade dessas.
  while (blob.size > TECTO_KB * 1024 && qualidade > 0.55) {
    qualidade -= 0.08;
    blob = await paraBlob(tela, qualidade);
  }

  return {
    blob,
    largura,
    altura,
    original: { largura: larguraOriginal, altura: alturaOriginal, bytes: ficheiro.size },
    qualidade: Math.round(qualidade * 100),
  };
}

function paraBlob(tela, qualidade) {
  return new Promise((resolve) => tela.toBlob(resolve, 'image/jpeg', qualidade));
}

/** Blob → base64, em pedaços. Um `String.fromCharCode(...bytes)` de uma vez
 *  rebenta a pilha de chamadas num ficheiro de 900 KB. */
export async function paraBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binario = '';
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo) {
    binario += String.fromCharCode.apply(null, bytes.subarray(i, i + passo));
  }
  return btoa(binario);
}

export function pesoLegivel(bytes) {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
