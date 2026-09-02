// Frases base per a l'entrenament.
//
// Dos criteris al darrere:
//
// 1. El bloc fonetic cobreix els sons on el catala sol punxar (vocal neutra,
//    l geminada, ny, ix, tj, essa sonora, erra final, xifres).
// 2. El bloc de feina repeteix a proposit cada terme important en tres o mes
//    frases. Amb el llindar per defecte cal sentir el mateix error dos cops
//    abans de convertir-lo en regla, aixi que una paraula que nomes surti una
//    vegada no s'apren mai. Fes el mateix amb les teves frases.
(() => {
  "use strict";

  const CORPUS_BASE = [
    // --- Fonetica general -------------------------------------------------
    "El col·legi de Girona organitza una xerrada sobre intel·ligència artificial.",
    "Ahir vaig pujar amb la bicicleta i vaig arribar dalt completament exhaust.",
    "La pluja fina de la matinada ha deixat tots els carrers relliscosos.",
    "Els nens juguen a la platja mentre els pares prenen cafè a la terrassa.",
    "No trobo les claus del cotxe ni la cartera enlloc de la casa.",
    "M'agradaria saber quant costa enviar aquest paquet a les Illes Balears.",
    "La Mercè i el Jordi han quedat per esmorzar al bar de la cantonada.",
    "Vint-i-tres persones s'han apuntat al taller de fotografia digital.",
    "Aquell restaurant de Palafrugell fa un arròs de peix excel·lent.",
    "El metge m'ha dit que he de fer més exercici i menjar menys sucre.",
    "Han canviat l'horari dels trens i ara surten cada mitja hora.",
    "El passeig de la platja estava ple de gent diumenge a la tarda.",
    "Quaranta-cinc mil dos-cents euros és una xifra que cal comprovar.",
    "La setmana que ve tanquem per vacances del dilluns al divendres.",

    // --- Girofeeds --------------------------------------------------------
    "Girofeeds genera els catàlegs de producte per a Google Ads i per a Meta.",
    "Aquest matí he desplegat una versió nova de Girofeeds sense cap error.",
    "El client m'ha escrit per preguntar si Girofeeds ja suporta el seu ERP.",
    "A Girofeeds tenim pendent revisar els comptes que no sincronitzen.",

    // --- Feeds i catalegs -------------------------------------------------
    "He actualitzat el feed de productes del Merchant Center aquest matí.",
    "El feed complementari s'ha de pujar cada nit de manera automàtica.",
    "Hem de comprovar per què el feed principal torna tants productes rebutjats.",
    "El catàleg en XML pesa més de cent megues i triga molt a processar-se.",
    "Al catàleg hi ha productes sense codi de barres ni marca declarada.",
    "Puja el catàleg complet al Merchant Center abans de dos quarts de nou.",
    "El Merchant Center ens ha marcat quaranta articles com a no aptes.",

    // --- Google Ads i campanyes -------------------------------------------
    "La campanya de cerca ha gastat gairebé tot el pressupost diari.",
    "Al compte de Google Ads hi ha tres campanyes actives i dues pausades.",
    "Vull pujar el pressupost de la campanya de marca un vint per cent.",
    "El pressupost d'aquest trimestre encara no està aprovat pel client.",
    "La conversió de la campanya ha baixat respecte del mes passat.",
    "Necessito el pressupost i la previsió de Google Ads per dilluns.",

    // --- Gestio del dia a dia ---------------------------------------------
    "La targeta del Trello està assignada i espera una revisió tècnica.",
    "Mou la targeta del Trello a la columna de fet quan acabis la feina.",
    "He obert una targeta al Trello per no perdre aquesta incidència.",
    "He revisat les factures de l'agost i n'hi ha dues de duplicades.",
    "Envia'm la factura en PDF i te la pago aquesta mateixa setmana.",
    "Falta la factura del proveïdor per tancar la comptabilitat del mes.",
    "Passa'm el número de comanda i miro l'estat de l'enviament.",
    "Aquesta comanda va sortir divendres i encara no ha arribat al client.",
    "El client vol canviar els preus de tota la tarifa abans de divendres.",
    "Escriu-li per WhatsApp que la reunió es trasllada a les quatre.",
    "Contesta-li per WhatsApp que ja tenim el pressupost preparat.",
    "Necessito exportar les comandes d'aquest trimestre en format CSV.",
    "Cal enviar la proposta per correu electrònic abans de dilluns al matí.",
    "Aquesta extensió de Chrome escriu directament al camp de text actiu."
  ];

  if (typeof window !== "undefined") window.__dictatCorpusBase_v1__ = CORPUS_BASE;
  if (typeof globalThis !== "undefined") globalThis.DictatCorpusBase = CORPUS_BASE;
})();
