// Passwords of /wisielec (services/hangman.js): Polish, lower case, grouped by category. The category is shown as a hint.
// Only letters of the Polish alphabet (no q, v, x: the letter menus do not have them), spaces and hyphens.
// Add new entries at the end of a category.

export const HANGMAN_CATEGORIES = Object.freeze({
  Minecraft: [
    'creeper', 'enderman', 'diament', 'obsydian', 'kilof', 'szkielet', 'wioska', 'portal', 'smok endu', 'mieszkaniec wioski',
    'pochodnia', 'skrzynia', 'kopalnia', 'redstone', 'zaklinanie', 'biblioteczka', 'mikstura', 'złote jabłko', 'żelazny miecz',
    'stół rzemieślniczy', 'piec', 'łóżko', 'nether', 'kowadło', 'wiadro lawy', 'perła endu', 'tarcza', 'trójząb', 'golem', 'szmaragd',
    'blok trawy', 'magma', 'lodowy kolec', 'grzyb', 'kaktus',
  ],
  'Internet i YouTube': [
    'miniaturka', 'subskrypcja', 'komentarz', 'transmisja', 'montaż', 'wyświetlenia', 'mikrofon', 'kamera', 'kanał', 'powiadomienie',
    'dzwoneczek', 'streamer', 'czat', 'emotka', 'serwer discord', 'nagranie', 'klikbajt', 'hasztag', 'algorytm', 'przeglądarka',
    'hasło', 'klawiatura', 'słuchawki', 'monitor', 'internet', 'aplikacja', 'smartfon', 'ładowarka', 'gra komputerowa', 'konsola',
  ],
  Jedzenie: [
    'pierogi', 'bigos', 'kebab', 'pizza', 'frytki', 'rosół', 'schabowy', 'żurek', 'naleśniki', 'gołąbki',
    'hamburger', 'czekolada', 'lody', 'kanapka', 'jajecznica', 'makaron', 'ogórek kiszony', 'truskawka', 'arbuz', 'ziemniak',
    'pomidorowa', 'sernik', 'pączek', 'szarlotka', 'budyń', 'kiełbasa', 'chleb z masłem', 'żelki', 'popcorn', 'gofry',
  ],
  Zwierzęta: [
    'żółw', 'słoń', 'krokodyl', 'żyrafa', 'pingwin', 'wiewiórka', 'chomik', 'papuga', 'delfin', 'rekin',
    'motyl', 'biedronka', 'jeżozwierz', 'kangur', 'niedźwiedź', 'dzik', 'bocian', 'sowa', 'lis', 'kot',
    'pies', 'koń', 'krowa', 'świnia', 'kura', 'ośmiornica', 'meduza', 'wielbłąd', 'nosorożec', 'hipopotam',
  ],
  Polska: [
    'warszawa', 'kraków', 'gdańsk', 'wrocław', 'poznań', 'zakopane', 'bałtyk', 'tatry', 'wisła', 'smok wawelski',
    'syrenka', 'giewont', 'morskie oko', 'malbork', 'toruń', 'pierniki', 'oscypek', 'biało-czerwoni', 'orzeł biały', 'mazury',
    'bieszczady', 'lublin', 'rzeszów', 'katowice', 'sopot',
  ],
  Szkoła: [
    'matematyka', 'biologia', 'historia', 'geografia', 'wychowawca', 'sprawdzian', 'kartkówka', 'zeszyt', 'piórnik', 'tablica',
    'dzwonek', 'przerwa', 'świadectwo', 'plecak', 'linijka', 'dziennik', 'stołówka', 'wakacje', 'korepetycje', 'praca domowa',
  ],
  Rzeczy: [
    'parasol', 'telewizor', 'lodówka', 'pralka', 'odkurzacz', 'rower', 'hulajnoga', 'samochód', 'pociąg', 'samolot',
    'zegarek', 'okulary', 'latarka', 'plaster', 'poduszka', 'kołdra', 'szczoteczka', 'mydło', 'ręcznik', 'krzesło',
    'drabina', 'młotek', 'śrubokręt', 'nożyczki', 'balon',
  ],
  Sport: [
    'piłka nożna', 'siatkówka', 'koszykówka', 'skoki narciarskie', 'pływanie', 'bramkarz', 'sędzia', 'rzut karny', 'mundial', 'tenis',
    'kolarstwo', 'boks', 'maraton', 'łyżwy', 'narty', 'deskorolka', 'trener', 'stadion', 'medal', 'puchar',
  ],
});

export const HANGMAN_WORDS = Object.freeze(Object.entries(HANGMAN_CATEGORIES)
  .flatMap(([category, words]) => words.map((word) => Object.freeze({ word, category }))));
