MealPlan v1.5 — calendar cu date, analiza meniurilor, greutate, fotografii locale, 6 teme x zi/noapte, meniu lateral.
1. Fa backup JSON din versiunea actuala.
2. Incarca toate fisierele din acest folder direct la radacina repository-ului MealPlan pe GitHub.
3. Commit changes; asteapta deploy Pages si redeschide PWA.
4. Planul vechi pe zile 0-6 este atribuit saptamanii in care deschizi pentru prima oara v1.5; datele vechi nu aveau datari calendaristice.
5. Planurile pe date si cantitatile de greutate sunt in localStorage, fotografiile in IndexedDB. Backup JSON nu include fotografiile si nici fotografiile private ale retetelor.
6. Pastreaza separat arhiva privata de retete si originalele fotografiilor. Nu incarca biblioteci private sau fotografii personale pe GitHub.
