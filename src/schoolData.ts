// Shared types keep the home screen and register using the same data shape.
export type Student = {
  id: string
  name: string
}

export type SchoolClass = {
  name: string
  students: Student[]
}

// Fictional development data. Keep IDs stable because attendance uses them
// to identify students, even if a student's display name changes.
export const classes: SchoolClass[] = [
  {
    name: 'Primary 5',
    students: [
      { id: '001', name: 'Amina Nakato' },
      { id: '002', name: 'Daniel Kato' },
      { id: '003', name: 'Grace Namuli' },
      { id: '004', name: 'Samuel Okello' },
    ],
  },
  {
    name: 'Primary 6',
    students: [
      { id: '005', name: 'Esther Nansubuga' },
      { id: '006', name: 'Brian Mugisha' },
      { id: '007', name: 'Faith Akello' },
      { id: '008', name: 'Isaac Ssemanda' },
      { id: '009', name: 'Mary Atim' },
    ],
  },
  {
    name: 'Primary 7',
    students: [
      { id: '010', name: 'Sarah Nabirye' },
      { id: '011', name: 'Joshua Ouma' },
      { id: '012', name: 'Ruth Nakiwala' },
    ],
  },
]