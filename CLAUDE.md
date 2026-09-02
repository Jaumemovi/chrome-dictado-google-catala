# Instruccions del projecte

## Registre d'errors de dictat per veu (bus cap a l'extensió)

Jaume dicta per veu en català amb una extensió de Chrome pròpia. El
reconeixement de Chrome comet errors **sistemàtics**. Quan en detectis un
durant la conversa, anota'l al card de Trello perquè acabi al diccionari de
correccions de l'extensió.

- **Card:** https://trello.com/c/vML21TbP — checklist **"Pendents"**
- **Format:** una línia per correcció → `sentit => correcte`

### Quan anotar-ho

Quan pel context entenguis que una paraula o expressió escrita **no és el que
Jaume volia dir**, sinó una mala transcripció de la seva veu.

### Criteris de seguretat (IMPORTANT)

L'extensió aplica les regles de manera **CEGA**, sense cap context. Tu tens
context; ella no. Una regla insegura corromp text que era correcte.

1. **Mai** una paraula catalana legítima com a `sentit`.
   `clau => Claude` és inacceptable: destrossaria "les claus del cotxe".
2. Si la paraula és ambigua, desambigua-la amb una expressió de 2-5 paraules:
   `el clau code => el Claude Code`.
3. Màxim **5 paraules** a cada costat i **sense puntuació** al mig
   (una regla no pot creuar el final d'una frase).
4. Els **accents compten**: escriu-los bé a la banda `correcte`.
5. Un mateix `sentit` només pot tenir un `correcte`.
6. Si la paraula **no apareix gens** a la transcripció, no es pot arreglar amb
   una substitució (no hi ha res a on enganxar-la). No l'anotis.
7. Davant del dubte, **no anotis**. Un fals positiu fa més mal que una
   correcció que no s'aprèn.

### Què NO fer

No afegeixis regles directament dins de l'extensió (la caixa "Afegeix una
correcció a mà"). El card de Trello és l'**única font de veritat** de les
regles manuals: l'import les substitueix senceres i les que no hi siguin es
perdrien.
