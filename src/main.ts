import './styles.css';
import { App } from './app/App';

function fail(message: string): void {
  const fatal = document.querySelector<HTMLElement>('#fatal');
  if (fatal) {
    fatal.hidden = false;
    fatal.textContent = message;
  }
  // eslint-disable-next-line no-console
  console.error(message);
}

function start(): void {
  const stage = document.querySelector<HTMLElement>('#stage');
  if (!stage) {
    fail('Не найден контейнер #stage');
    return;
  }
  try {
    new App(stage);
  } catch (error) {
    fail(
      'Не удалось запустить 3D-сцену: ' +
        (error instanceof Error ? error.message : String(error)) +
        '\nТребуется браузер с поддержкой WebGL2.',
    );
  }
}

start();
