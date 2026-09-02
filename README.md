# Dictat en català

Extensio minima per a Google Chrome/Chromium a Linux que permet dictar text al
camp actiu amb `Ctrl+Space`, amb un diccionari de correccions que s'entrena amb
la teva veu.

## Que fa i que no fa l'entrenament

La Web Speech API **no es pot entrenar**. El reconeixement el fa Google al seu
servidor (o el model local de Chrome) i l'extensio nomes en rep el text ja
transcrit: no toca mai l'audio i no hi ha cap ganxo d'adaptacio de locutor. El
`SpeechGrammarList` de l'estandard existeix a Chrome pero no fa res.

El que si que es pot fer, i es el que fa aquesta extensio, es aprendre els teus
errors **sistematics**. Quan llegeixes textos coneguts, l'extensio compara el
que havies de llegir amb el que Chrome ha entes, alinea les dues frases paraula
a paraula i n'extreu un diccionari personal de substitucions. Despres, mentre
dictes, aplica aquest diccionari al text abans d'inserir-lo.

En simulacio amb errors sistematics, el diccionari redueix entre un 40% i un 90%
de les paraules errades en frases que no s'havien entrenat, sense malmetre cap
frase que ja sortia be.

## Entrenament

1. Obre `chrome://extensions`, busca l'extensio i entra a **Opcions**
   (o assigna una drecera a "Obrir l'entrenament" a `chrome://extensions/shortcuts`).
2. Pestanya **El meu corpus**: escriu-hi les teves frases reals, amb noms de
   clients i termes tecnics. **Repeteix cada terme important en tres frases o
   mes**: amb el llindar per defecte cal sentir el mateix error dos cops abans
   de convertir-lo en regla, aixi que una paraula que nomes surti una vegada no
   s'apren mai. Si una paraula no surt al corpus, l'eina no pot aprendre a
   corregir-la.
3. Pestanya **Entrenament**: tria la mida de la sessio i comenca. Per cada
   frase, prem `Espai` (o el boto), llegeix-la en veu alta i espera. Veuras el
   que ha entes Chrome amb els errors marcats, i quines regles noves n'han
   sortit. `Enter` passa a la seguent.
4. Pestanya **Regles apreses**: revisa el diccionari, desactiva el que no
   t'agradi, afegeix correccions a ma i prova-les amb un text d'exemple.

Les lectures s'acumulen entre sessions, aixi que un error que surt un cop per
sessio acaba sent regla a la segona o tercera. Amb tres o quatre sessions ja
tens un diccionari util.

## Us del dictat

1. Obre WhatsApp Web, ChatGPT, Gmail o una altra web.
2. Fes clic al camp on vols escriure i deixa-hi el cursor.
3. Prem `Ctrl+Space`. La primera vegada Chrome demanara permis de microfon.
4. Parla. Torna a prémer `Ctrl+Space` per aturar.

Tambe pots prémer la icona de l'extensio a la barra de Chrome.

A mes de substituir el text, si tens vocabulari propi definit l'extensio demana
a Chrome fins a cinc transcripcions alternatives i es queda la que conte mes
termes teus, en comptes d'agafar sempre la primera.

## Privacitat

- No te servidor propi, ni analitica, ni cap `fetch`, WebSocket o crida HTTP.
- No demana acces permanent a totes les webs.
- Les lectures es guarden a `chrome.storage.local` **com a text** (la frase
  original i la transcripcio), mai com a audio, i nomes al teu Chrome. Les pots
  exportar o esborrar des de la pestanya "Dades i ajustos".
- Fa servir la Web Speech API (`SpeechRecognition`) inclosa a Chrome. Amb
  `processLocally = false`, Chrome pot fer servir reconeixement remot: aixo
  depen del servei configurat al navegador. L'extensio rep el text reconegut i
  no envia pel seu compte ni l'audio ni la transcripcio enlloc.

## Permisos

```json
"permissions": ["activeTab", "scripting", "storage"]
```

- `activeTab` i `scripting`: acces temporal a la pestanya nomes quan executes el
  comando. No hi ha `host_permissions` ni `<all_urls>`.
- `storage`: guardar el diccionari i les lectures.

El microfon **no** es declara al manifest: `audioCapture` nomes val per a
packaged apps i en una extensio Chrome l'ignora amb un avis. La pagina
d'entrenament el demana com qualsevol web, amb una crida a `getUserMedia`, i un
cop el concedeixes queda desat per a l'origen `chrome-extension://`. Per aixo la
pagina d'opcions s'obre en una pestanya (`open_in_tab`): dins del panell petit
d'opcions el dialeg de permis no es pot mostrar be.

## Idioma

Per defecte esta fixat a catala (`ca-ES`):

```js
const LANG = "ca-ES";
```

Es al principi de `dictation.js` i de `training.js`. Si el canvies, canvia'l als
dos llocs i comenca un corpus nou.

## Fitxers

| Fitxer | Que fa |
| --- | --- |
| `manifest.json` | Permisos, dreceres, pagina d'opcions |
| `background.js` | Llegeix el diccionari i injecta el dictat a la pestanya |
| `dictation.js` | Dictat al camp actiu, desempat d'alternatives i correccio |
| `corrections.js` | Motor de substitucions, compartit per dictat i entrenament |
| `align.js` | Alineacio referencia/transcripcio i extraccio de regles |
| `corpus.js` | Frases base d'entrenament |
| `training.html/.css/.js` | Pagina d'entrenament i gestio del diccionari |

## Instal·lacio

1. Descomprimeix la carpeta.
2. Obre `chrome://extensions`.
3. Activa **Mode de desenvolupador**.
4. Prem **Carrega descomprimida** i tria la carpeta.
5. A `chrome://extensions/shortcuts` comprova que tingui `Ctrl+Space`.

En alguns escriptoris de Linux `Ctrl+Space` esta reservat pel sistema o pel
metode d'entrada. Si no funciona, canvia la drecera, per exemple a
`Ctrl+Shift+Space` o `Alt+Shift+D`.

## Limitacions

- No funciona a pagines internes com `chrome://…` ni a la Chrome Web Store.
- Alguns editors web molt personalitzats poden necessitar tractament especific.
  Hi ha suport per a `input`, `textarea` i `contenteditable`, inclos el
  mecanisme que fan servir aplicacions com WhatsApp Web.
- La Web Speech API pot tancar una sessio despres d'un silenci; l'extensio la
  reinicia automaticament mentre el dictat segueixi actiu.
- Les correccions actuen sobre paraules senceres i no creuen puntuacio. Una
  paraula que el reconeixedor **no arriba a escriure** no es pot recuperar amb
  una substitucio, i per tant no genera cap regla.
