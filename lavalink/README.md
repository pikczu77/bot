# Własny serwer muzyki (Lavalink)

Bot gra muzykę przez serwery Lavalink. Domyślnie używa publicznych serwerów z `nodes.json`.
Są darmowe, ale bywają przeciążone i wtedy muzyka się zacina. Własny serwer gra tylko dla
Twojego bota.

## Co jest potrzebne

- Serwer z Javą 17 albo nowszą, najlepiej w Europie, co najmniej 512 MB RAM.
  Na bot-hosting.net wybierz serwer Java (albo gotowy typ "Lavalink", jeśli jest na liście).
- Plik `Lavalink.jar` w wersji 4: https://github.com/lavalink-devs/Lavalink/releases
- Plik `application.yml` z tego folderu.

## Krok po kroku

1. Utwórz nowy serwer Java na hostingu.
2. Wgraj `Lavalink.jar` i `application.yml` do głównego folderu serwera.
3. Ustaw plik startowy na `Lavalink.jar`.
4. Wymyśl długie hasło. Ustaw je na serwerze Lavalink jako zmienną `LAVALINK_PASSWORD`
   albo wpisz je w `application.yml` zamiast `youshallnotpass`.
5. Jeśli hosting daje inny port niż 2333, ustaw zmienną `SERVER_PORT` albo zmień `port` w `application.yml`.
6. Uruchom serwer. W konsoli musi pojawić się `Lavalink is ready to accept connections`.
7. W pliku `.env` bota dopisz:

   ```
   LAVALINK_HOST=adres-serwera-lavalink
   LAVALINK_PORT=port-serwera
   LAVALINK_PASSWORD=to-samo-haslo
   LAVALINK_SECURE=false
   ```

8. Zrestartuj bota.

Bot najpierw używa Twojego serwera. Gdy Twój serwer padnie albo zacina (gubi ponad 4% dźwięku),
bot przełącza muzykę na publiczne serwery. `LAVALINK_ONLY_OWN=true` wyłącza publiczne serwery całkiem.

Hasło jest tajne. Nie wpisuj go do `nodes.json` ani do niczego, co trafia do repozytorium.
