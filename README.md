# 3D Rubik's Cube

Интерактивный масштабируемый 3D Rubik's Cube (N×N×N до 1000×1000×1000) с физической анимацией слоёв и вычислительным solver'ом.

## Особенности

- **Масштабируемость**: поддержка размеров от 2×2×2 до 1000×1000×1000
- **Компактное состояние**: только 6 × N² байт (Uint8Array), никаких N³ объектов
- **Физическая анимация**: каждый поворот слоя — реальная 3D-анимация 90°
- **Мгновенное перемешивание**: генерация и применение scramble без анимации
- **Вычислительный Solver**: инвертирует историю ходов, валидирует на копии, работает в Web Worker
- **WebGL2 рендерер**: 6 статических face-quads + 1 moving slab (O(1) draw calls)
- **Пауза/продолжение**: во время scramble и solve
- **Debug-панель**: FPS, N, move count, layer, axis, angle, solver mode

## Локальный запуск

```bash
# Установка зависимостей
npm install

# Dev-сервер с HMR
npm run dev

# Или
npm start

# Production build
npm run build

# Preview production build
npm run preview

# Запуск тестов
npm test

# TypeScript type check
npm run typecheck
```

## Публикация на GitHub Pages

1. Создайте репозиторий на GitHub с именем `rubiks-cube`
2. Добавьте remote и загрузите код:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/rubiks-cube.git
   git push -u origin main
   ```
3. В настройках репозитория: **Settings → Pages → Build and deployment → Source: GitHub Actions**
4. При следующем push в `main` workflow автоматически соберёт и задеплоит сайт
5. Сайт будет доступен по адресу: `https://YOUR_USERNAME.github.io/rubiks-cube/`

## Live Demo

После публикации будет доступно по адресу:
**https://USERNAME.github.io/rubiks-cube/**

*(замените USERNAME на ваш GitHub username)*

## Архитектура

```
src/
├── app/              # Application orchestrator
├── anim/             # Move animation (easing, pause/resume)
├── core/             # CubeState, Scramble, Solver, geometry
├── render/           # Three.js renderer (procedural, texture-based)
├── solver/           # Web Worker client for solver
├── ui/               # DOM bindings (panels, status, debug)
├── worker/           # Solver Web Worker
└── types/            # TypeScript types
```

## Технологии

- TypeScript
- Vite
- Three.js (WebGL2)
- Vitest
- Web Workers

## Лицензия

MIT