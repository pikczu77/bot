// Words of the daily /wordle (2026-10-26): common Polish five-letter words, no names, nothing rude.
// Guesses may be any five Polish letters; only the word of the day comes from this list.
// test/wordle.test.js checks that each word has exactly five letters.
// 2026-10-27 (owner: "wiecej ogolnych wordle"): 161 more everyday words appended at the end. Add new words only at
// the end and add a line to LIST_SIZES in services/wordle.js, so the words of past days stay the same.

export const WORDLE_WORDS = `
akcja alarm album aleja anioł arena armia atlas autor babka bagno balon banan barka barwa bazar
belka beton bieda biuro blask bluza bomba brama broda bucik budka bułka burza cegła chata chleb
cisza córka cytat deska dobro domek dowód drzwi dusza dynia dywan fajka farba firma flaga forma
fotel front gałąź garaż głowa góral grosz grupa gumka hasło hotel iskra kabel kajak kakao kamyk
kanał kapeć karta kasza katar kawał kibic kiosk klasa klucz kobra kolor konik korek koszt kotek
kozak krowa krzak kubek kucyk kufer kulka kwiat lampa laska lider lilia linia lisek łapka łóżko
łyżka magia mamut marka maska masło miecz miska mleko model morze motyl mucha muzyk nauka nerka
obiad obraz ocean ogień opera orzeł osioł palec panda pasek pasta pchła perła piana piłka pizza
plaża pokój pompa potok praca prawo proca puder pudło ramka rejon robot rower rybak rynek sanki
serce sklep skarb skała słoik stado strój sufit szafa szyba świat talia tenis tęcza torba trawa
ulica wafel wagon walka wanna wazon widok wózek wyspa zamek zebra zegar kilof szlam jajko jeleń
kogut koala lwica małpa pająk sroka szpak wydra bigos kefir lizak żurek melon mango napój mydło
radio ekran pilot narty łyżwy rolki rzeka śnieg wiatr niebo płuca język plecy szyja włosy kreda
ocena wideo złoto łódka golem rybka śpiew wynik punkt medal gracz biały żółty szary stary długi
wolny zimny mokry suchy słaby silny ładny dobry cichy drogi pełny pusty ostry gruby chudy niski
mądry pisać latać
burak dziób mapka pióro powód stopa worek żabka arbuz groch seler rzepa zupka serek kebab sushi schab zając indyk sokół
rekin hiena sarna komar robak sosna jodła grzyb górka wydma ogród ranek dzień środa uczeń basen start salon winda półka
kocyk konto autko metro bilet droga tunel peron aktor fanka wujek bobas pirat bęben scena bajka złość wybór humor płacz
hałas ramię czoło skóra złoty młody łatwy lekki jasny mocny słony chory pewny ważny nudny super fajny modny mówić robić
lubić kupić uczyć dawać leżeć łowić kopać nosić kółko lalka misio psiak kotka rogal obrus kubeł grill błoto wieża skrót
emoji ikona misja order remis runda seria sezon finał karny sport hobby bingo rebus szyfr rabat zakup towar urząd teatr
pałac willa notes umowa urlop ferie bagaż guzik nitka taśma sznur linka węzeł śruba kokos omlet budyń rosół lokal ciało
kawka brzeg wodny trasa pałka kolej baton kurek sówka lotos kanoe jacht fiord ekipa banda zgoda napis słowo wyraz tekst
zwrot
`.trim().split(/\s+/);
