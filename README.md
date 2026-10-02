# APWEN Blog: backend

API for the APWEN blog: stories, rich content, image uploads, editors and site settings. No npm dependencies, just Node 22.13+.

```bash
cp .env.example .env
npm run seed      # first admin + sample stories
npm run dev       # http://localhost:4000
npm test
```

Frontend: [`apwen-blog-frontend`](../apwen-blog-frontend). Architecture, API reference and deployment notes are in `CLAUDE.md`. The design system lives in the frontend's `DESIGN.md`.
