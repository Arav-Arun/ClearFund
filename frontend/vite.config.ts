import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Link previews need absolute URLs. The site's own address comes from the host at build time
// (Vercel provides its production domain), so no domain is written into the code. Locally it is
// empty and the links stay relative.
const production = process.env.VERCEL_PROJECT_PRODUCTION_URL
const site = process.env.VITE_SITE_URL || (production ? `https://${production}` : '')
const siteUrl = { name: 'site-url', transformIndexHtml: (html: string) => html.replaceAll('%SITE_URL%', site) }

export default defineConfig({
  envDir: '..',
  plugins: [react(), siteUrl],
  publicDir: 'assets',
})
