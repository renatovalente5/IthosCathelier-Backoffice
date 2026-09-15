# Ensaiar o backoffice sem token

`_teste.html` arranca o backoffice inteiro contra um **GitHub falso**: finge a
API do GitHub por cima dos ficheiros verdadeiros do repositório do site, servidos
por HTTP da pasta ao lado. Sem token, sem rede, e sem tocar no repositório.

Serve para ver o que só se vê a conduzir: se um ecrã rebenta, se um campo grava
o que diz que grava, e o que é que o botão «Gravar» ia mesmo escrever.

```bash
cd ../IthosCathelier && node scripts/indice-de-ensaio.mjs
```

Depois é preciso um servidor que sirva as **duas** pastas na mesma origem — o
`_teste.html` importa o `js/app.js` daqui e lê o conteúdo de `../IthosCathelier`,
e módulos entre origens diferentes precisavam de CORS:

```bash
python3 -m http.server 4323 --directory ..
```

E abrir `http://localhost:4323/IthosCathelier-Backoffice/_teste.html`.

## O que fica acessível durante o ensaio

- `window.__gravou` — a árvore do último commit (os caminhos que iam mudar).
- `window.__blobs` — o conteúdo de cada ficheiro que ia ser escrito.

Nada disto existe no backoffice a sério: vive só nesta página, que começa por
`_` e nunca é publicada.

## O que o ensaio NÃO prova

As miniaturas das fotografias dão 404 — apontam para `ithos-cathelier.pt`, que
ainda não existe. É esperado, e é o único ruído na consola.

Gravar não grava: o commit é fingido. Para provar que a escrita chega ao
repositório é preciso a coisa verdadeira, com um token.
