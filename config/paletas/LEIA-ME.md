# Modo de cores e paletas

O tema tem **duas paletas editáveis lado a lado** e um seletor no topo de
**Personalizar → Configurações do tema → Modo de cores**:

| Modo | Usa os grupos | Valores iniciais |
|---|---|---|
| **Claro** | `Claro · Marca e botões`, `Claro · Fundos e textos`, `Claro · Cabeçalho e menu`, `Claro · Barra de anúncios`, `Claro · Carrinho`, `Claro · Rodapé`, `Claro · Selos e avisos` | a loja clara original |
| **Escuro** | `Escuro · Marca e botões`, `Escuro · Fundos e textos`, `Escuro · Cabeçalho, barra e rodapé`, `Escuro · Selos e avisos` | Black November: preto + verde-limão |

Trocar o modo muda o site inteiro de uma vez e **não apaga nada**: as duas paletas
continuam guardadas. Os valores escuros já nascem como *padrão* dos campos
`Escuro · …` (por isso a paleta `black-november.json` só liga o modo).

Quem segue o modo sozinho: cabeçalho, páginas, carrinho, rodapé, selos, blocos da IA
da Shopify (cor em branco), a página do Ateliê e a página Esquenta Black (no Escuro
ela usa o tema geral).

**Cores escolhidas DENTRO de uma seção** no Personalizar vencem a paleta no modo Claro. A exceção é a **Barra de anúncios**: no modo Escuro a cor da seção é ignorada (ela costuma ser a do tema claro gravada na loja), e a barra usa sempre a paleta Escura.

## Conferir contraste (PageSpeed / WCAG AA = 4,5:1)

```bash
node scripts/contraste.js config/paletas/black-november.json        # pares por área
node scripts/contraste-css.js config/paletas/black-november.json   # lê o CSS real
# o mais útil ao mexer na paleta: só o que ficou PIOR que no claro
node scripts/contraste-css.js config/paletas/black-november.json --base config/paletas/loja-clara.json
```

Sem argumento, `contraste.js` mede o que está salvo hoje no editor
(`settings_data.json`). Com uma paleta, mede **padrões do schema + só a paleta**,
para uma cor de teste esquecida no editor não contaminar o resultado.

Os scripts **não enxergam**: texto sobre foto/vídeo, cores escolhidas dentro de seções,
o tamanho real do texto (tudo conta como texto normal; texto grande e ícones pedem 3:1)
e o que apps de terceiros pintam (Konfidency etc.). Confirme no PSI com o tema publicado.

## Arquivos

| Arquivo | O que é |
|---|---|
| `loja-clara.json` | a loja clara original, com `modo_cores: claro` (base de comparação) |
| `black-november.json` | liga o modo escuro (`modo_cores: escuro`) |

## Virar a loja para o escuro numa data

- **Pelo editor:** troque o Modo de cores e salve. Vale na hora para a loja publicada.
- **Com data marcada (Waltz → Aplicativos → Temas):** o Waltz publica *outro tema* na
  hora certa. Então duplique o tema na Shopify e deixe a cópia em modo Escuro:
  ```bash
  node scripts/gerar-settings-paleta.js config/paletas/black-november.json
  ```
  Gera `config/settings_data.black-november.json` (o conteúdo de hoje, com todas as
  cores soltas do editor zeradas e o modo em Escuro; **não altera** o
  `settings_data.json` atual e **não publica nada**). Numa branch, copie esse arquivo
  por cima do `settings_data.json` e faça `shopify theme push --theme <ID_DO_DUPLICADO>`.

## Regras que evitam surpresa em tema escuro
- "Sombras e véu escuro" fica **escuro** nos dois modos (senão a sombra vira brilho).
- "Texto sobre os selos coloridos" e "Texto sobre o dourado" seguem o tom dos selos:
  selos claros pedem texto escuro.
- Rodapé tem fundo e texto próprios (não depende da Cor Principal).
- "Texto sobre a Cor Principal" e o botão de compra precisam de contraste entre si.
