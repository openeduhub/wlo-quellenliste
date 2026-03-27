import { createApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { createCustomElement } from '@angular/elements';
import { AppComponent } from './app/app.component';

(async () => {
  const app = await createApplication({
    providers: [
      provideHttpClient(),
    ],
  });

  const WloSources = createCustomElement(AppComponent, { injector: app.injector });
  customElements.define('wlo-sources', WloSources);
})();
