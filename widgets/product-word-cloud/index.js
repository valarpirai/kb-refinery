import {html, css} from 'lit';
import {customElement} from 'lit/decorators.js';
import {
  AIUXWidgetElement,
  decorators,
  themeContext
} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import {icon} from '@servicenow/aiux/aiux-directive-icon';

const {name, description, bestFor, chatCompatible, category, server, discoverable} =
  decorators;

// Fallback qualitative palette for when --datavis-qualitative-N isn't
// defined on the active theme -- same tokens
// aiux-visualizations-composition resolves, so a themed instance still
// gets the platform's real palette; this only covers a theme that has no
// datavis tokens at all.
const FALLBACK_COLORS = [
  '#007b9e',
  '#00af9f',
  '#2ab98c',
  '#00b271',
  '#4fb8ae',
  '#7c6fe0',
  '#e07c3e',
  '#c94f6d'
];
const MAX_QUALITATIVE_TOKENS = 12;

// ServiceNow's own brand green -- the exact fill used by the platform's
// SERVICENOW_LOGO_ICON (@servicenow/aiux's nav package, nav-logos.js).
// Reserved exclusively for the "ServiceNow" word itself; _resolveColors()
// filters it out of the random pool below so no other product can land
// on it by chance.
const SERVICENOW_GREEN = '#52CB3D';

function isServiceNowProduct(productName) {
  return /^service-?now$/i.test(String(productName || '').trim());
}

@customElement('product-word-cloud')
@name('Product Word Cloud')
@description(
  'Word cloud of the products mentioned across knowledge articles, sized by article count.'
)
@bestFor(
  'Giving an at-a-glance view of which products the knowledge base covers most.'
)
@chatCompatible(false)
@category('custom')
@server('./server.js')
@discoverable(true)
export default class ProductWordCloud extends AIUXWidgetElement {
  static fetchDataOnConnect = false;

  static properties = {
    _loading: {state: true},
    _error: {state: true},
    _products: {state: true}
  };

  static styles = css`
    :host {
      display: block;
    }
    /*
     * The word cloud's SVG is painted by Highcharts via inline attributes,
     * not author CSS, so forced-colors mode leaves it alone by default --
     * but its whole point (word size/color) is still visual information
     * for a sighted forced-colors user, unlike the sr-only list below
     * (which serves assistive tech, not sighted users). Pinning this
     * explicitly rather than relying on that default matches the same
     * call this page's own rail makes for the same reason (see
     * page.js's .rail-track forced-colors block).
     */
    @media (forced-colors: active) {
      .chart-container {
        forced-color-adjust: none;
      }
    }
  `;

  constructor() {
    super();
    this._loading = true;
    this._error = '';
    this._products = [];
    this._highcharts = null;
    this._chart = null;
    this._unsubscribeTheme = null;
    this._resizeObserver = null;
  }

  /**
   * Deliberately firstUpdated(), not connectedCallback() -- the latter also
   * runs during SSR, and this widget both fetches and (once data lands)
   * touches the DOM/Highcharts, either of which racing hydration would
   * duplicate the render (see widget-and-page-conventions.md).
   */
  firstUpdated() {
    void this._fetchProducts();
    this._unsubscribeTheme = themeContext.subscribe(() => this._rebuildChart());
    this._resizeObserver = new ResizeObserver(() => this._chart?.reflow());
    this._resizeObserver.observe(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsubscribeTheme?.();
    this._resizeObserver?.disconnect();
    this._chart?.destroy();
    this._chart = null;
  }

  async _fetchProducts() {
    this._loading = true;
    try {
      const response = await this.server.get({action: 'getProducts'});
      if (response?.isError) {
        this._error = response.errorMessage || i18n.getMessage('Failed to load products');
      } else {
        this._error = '';
        this._products = response.products || [];
      }
    } catch (e) {
      this._error = i18n.getMessage('Failed to load products');
    } finally {
      this._loading = false;
    }
  }

  updated(changed) {
    if (
      changed.has('_products') &&
      !this._loading &&
      !this._error &&
      this._products.length
    ) {
      void this._rebuildChart();
    }
  }

  async _rebuildChart() {
    if (!this._products.length) return;
    const container = this.renderRoot?.querySelector('.chart-container');
    if (!container) return;
    const Highcharts = await this._loadHighcharts();
    if (!Highcharts) return;
    // A slower-resolving load can land after this widget's own data
    // changed again, or after it disconnected -- both are checked before
    // touching the DOM.
    if (!this.isConnected || !this._products.length) return;

    this._chart?.destroy();
    this._chart = Highcharts.chart(container, this._buildChartConfig());
  }

  async _loadHighcharts() {
    if (this._highcharts) return this._highcharts;
    try {
      // Imported together, from this one dynamic-import call site, so the
      // wordcloud module registers its series type onto the same
      // Highcharts instance this widget renders with -- see
      // karuna-component-integration.md's "Highcharts inside a
      // karuna-based app" section. Dynamic import() also keeps the real
      // library out of the SSR isolate bundle, where it's useless anyway
      // (no DOM to draw an SVG word cloud into).
      const [core] = await Promise.all([
        import('highcharts/esm/highcharts.js'),
        import('highcharts/esm/modules/wordcloud.js'),
        import('highcharts/esm/modules/accessibility.js')
      ]);
      this._highcharts = core.default;
    } catch (e) {
      this._error = i18n.getMessage('Failed to load the chart library');
    }
    return this._highcharts;
  }

  /**
   * Theme-approved qualitative palette only (the same tokens
   * aiux-visualizations-composition resolves) -- with the reserved
   * ServiceNow-green filtered out so a random pick can never land a
   * non-ServiceNow word on it, even if a theme's own palette happens to
   * include that exact green.
   */
  _resolveColors() {
    const style = getComputedStyle(this);
    const colors = [];
    for (let i = 0; i < MAX_QUALITATIVE_TOKENS; i++) {
      let val = style.getPropertyValue(`--datavis-qualitative-${i}`).trim();
      if (!val) break;
      const varRef = val.match(/^var\(\s*(--[\w-]+)/);
      if (varRef) val = style.getPropertyValue(varRef[1]).trim() || val;
      colors.push(val);
    }
    const palette = colors.length ? colors : FALLBACK_COLORS;
    return palette.filter(c => c.toLowerCase() !== SERVICENOW_GREEN.toLowerCase());
  }

  _randomColor(palette) {
    return palette[Math.floor(Math.random() * palette.length)];
  }

  _buildChartConfig() {
    const palette = this._resolveColors();
    return {
      chart: {
        type: 'wordcloud',
        backgroundColor: 'transparent',
        style: {fontFamily: 'inherit'}
      },
      title: {text: null},
      credits: {enabled: false},
      colors: palette,
      tooltip: {pointFormat: '<b>{point.name}</b>: {point.weight}'},
      accessibility: {enabled: true},
      series: [
        {
          type: 'wordcloud',
          name: i18n.getMessage('Articles'),
          data: this._products.map(p => ({
            name: p.name,
            weight: p.count,
            color: isServiceNowProduct(p.name)
              ? SERVICENOW_GREEN
              : this._randomColor(palette)
          })),
          colorByPoint: true,
          rotation: {from: 0, to: 0, orientations: 1},
          minFontSize: 12,
          maxFontSize: 42,
          style: {fontFamily: 'inherit', fontWeight: '600'}
        }
      ]
    };
  }

  render() {
    return html`
      <div class="aiux-card bg-base-100 shadow-sm">
        <div class="aiux-card-body gap-3 p-6">
          <h3 class="aiux-card-title text-base text-text-primary">
            ${i18n.getMessage('Products mentioned')}
          </h3>
          ${this._renderBody()}
        </div>
      </div>
    `;
  }

  _renderBody() {
    if (this._loading) return this._renderSkeleton();
    if (this._error) return this._renderError();
    if (!this._products.length) return this._renderEmpty();
    return this._renderChart();
  }

  _renderSkeleton() {
    return html`<div class="aiux-skeleton h-[320px] w-full rounded"></div>`;
  }

  _renderError() {
    return html`
      <div class="aiux-alert aiux-alert-error aiux-alert-soft">
        ${icon({name: 'circle-exclamation', size: 'sm'})}
        <span>${this._error}</span>
      </div>
    `;
  }

  _renderEmpty() {
    return html`
      <div class="flex flex-col items-center gap-2 py-10 text-center">
        ${icon({name: 'inbox', size: 'lg'})}
        <p class="text-sm text-text-tertiary">
          ${i18n.getMessage('No products found yet.')}
        </p>
      </div>
    `;
  }

  /**
   * The chart is a visualization of the same list the <ul> below already
   * states as text -- aria-hidden so assistive tech isn't given both a
   * redundant announcement and an unreadable SVG (WCAG 1.1.1: the list
   * *is* the text alternative, not a caption alongside the real content).
   */
  _renderChart() {
    return html`
      <div class="chart-container h-[320px] w-full" aria-hidden="true"></div>
      <ul class="sr-only">
        ${this._products.map(
          p => html`<li>
            ${i18n.getMessage('{name}: {count} articles', {
              name: p.name,
              count: String(p.count)
            })}
          </li>`
        )}
      </ul>
    `;
  }
}
