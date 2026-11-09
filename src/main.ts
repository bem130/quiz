import { QuizApplication } from './web/application.ts';
import './web/app.css';

const host = document.getElementById('app');
if (host instanceof HTMLElement) {
    const app = new QuizApplication(host);
    app.start().catch((error: unknown) => {
        host.replaceChildren(document.createTextNode(error instanceof Error ? error.message : '起動に失敗した。ページを再読み込みして再試行できる。'));
    });
}
