import { inject } from '@angular/core';
import { Router, type Routes } from '@angular/router';

import { TeamStore } from './data/team-store.service';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    // Sin equipo guardado no hay nada que calcular: se empieza por el equipo.
    redirectTo: () =>
      inject(Router).parseUrl(inject(TeamStore).teams().length ? '/seleccion' : '/equipo'),
  },
  {
    path: 'seleccion',
    title: 'title.pick',
    loadComponent: () => import('./pages/pick/pick-page').then((m) => m.PickPage),
  },
  {
    path: 'calculadora',
    title: 'title.calc',
    loadComponent: () => import('./pages/calc/calc-page').then((m) => m.CalcPage),
  },
  {
    path: 'meta',
    title: 'title.meta',
    loadComponent: () => import('./pages/meta/meta-page').then((m) => m.MetaPage),
  },
  {
    path: 'equipo',
    title: 'title.team',
    loadComponent: () => import('./pages/team/team-page').then((m) => m.TeamPage),
  },
  { path: '**', redirectTo: '' },
];
