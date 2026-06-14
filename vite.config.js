import { defineConfig } from 'vite'

export default defineConfig({
  // Serve from root so all pages work
  root: '.',
  build: {
    outDir: 'dist',
    // Tell Vite about all our HTML entry points
    rollupOptions: {
      input: {
        main: 'index.html',
        set: 'set.html',
        adminLogin: 'admin/login.html',
        adminIndex: 'admin/index.html',
        adminEdit: 'admin/edit.html',
        adminCategories: 'admin/categories.html',
        adminProfiles: 'admin/profiles.html',
      }
    }
  },
  server: {
    port: 5173,
    open: true
  }
})
