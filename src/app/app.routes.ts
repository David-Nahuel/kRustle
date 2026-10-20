import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/team-import/team-import').then((m) => m.TeamImport),
  },
  {
    path: 'calculator',
    loadComponent: () =>
      import('./features/calculator/calculator').then((m) => m.Calculator),
  },
  {
    path: '**',
    redirectTo: '',
  },
];