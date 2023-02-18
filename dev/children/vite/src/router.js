import Home from './pages/home.vue'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: Home
  },
  {
    path: '/page2',
    name: 'page2',
    component: () => import('./pages/page2.vue')
  },
  {
    path: '/page3',
    name: 'page3',
    component: () => import('./pages/page3.vue')
  }
]

export default routes
