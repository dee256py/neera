# Neera
### Another Chance to Learn

Neera is an attendance and school continuity platform being developed
for Ugandan primary and secondary schools.

It is designed for teachers, including those with limited technical
experience and schools with unreliable internet access. Students do
not need phones.

## Project status

Early prototype using fictional student data.

### Working features
- Class selection
- Present, absent and late attendance marking
- Mark all students present
- Live attendance totals
- Separate daily registers for each class
- Attendance saved locally in the browser
- Read-only attendance history
- Warning before leaving a register with unsaved changes

### Planned features
- Student search and attendance filters
- Offline app loading
- School accounts and secure access
- Synchronisation with a school database
- School administration dashboard
- Parent and guardian SMS notifications
- Teacher-managed catch-up materials

## Technology

- React
- TypeScript
- Vite
- CSS
- Browser localStorage
- ESLint

## Run locally

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the local URL shown in the terminal.

## Code checks

```bash
npm run lint
npm run build
```

## Current limitations

Attendance is stored only in the browser and device where it was saved.
Clearing browser site data can delete those records.

The app does not yet support offline reopening, school synchronisation,
authentication or SMS delivery.

The prototype uses four fictional students per class. Class sizes on
the home screen are illustrative.

## Development log

### 26 October 2026
- Created the React and TypeScript project.
- Built class selection and attendance marking.
- Added local saving by class and date.
- Added read-only attendance history.
- Successfully built the project.
- Initialised Git version control.

### 27 October 2026
- Added separate fictional class rosters and calculated student counts.
- Updated attendance loading to use the selected class roster.
- Started a separate v2 store for the updated demo registers.

### 29 October 2026
- Added service worker caching for offline app reopening.
- Added offline-ready and app-update notifications.
- Verified offline refresh, draft recovery, attendance confirmation and history.
- Offline use requires an initial successful load and cache setup.

## Author

Daisy Juliana Babirye