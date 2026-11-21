export default function server(data, _options, input) {
  var action = (input && input.action) || 'getProducts';

  if (action === 'getProducts') {
    // Capped, not a full table dump -- a word cloud beyond a few dozen
    // words stops being legible anyway, and article_count is already the
    // maintained fast-tile counter (see x_snc_kb_refinery_product's own
    // schema comment), so no join through x_snc_kb_refinery_mention is
    // needed for this weight.
    var limit = 60;
    try {
      var gr = new GlideRecordSecure('x_snc_kb_refinery_product');
      gr.addQuery('article_count', '>', 0);
      gr.orderByDesc('article_count');
      gr.setLimit(limit);
      gr.query();

      var products = [];
      while (gr.next()) {
        products.push({
          name: gr.getDisplayValue('name'),
          count: parseInt(gr.getValue('article_count'), 10) || 0
        });
      }

      data.products = products;
    } catch (e) {
      gs.error('product-word-cloud getProducts: ' + e.message);
      data.isError = true;
      data.errorMessage =
        gs.getMessage('Failed to load products') + ': ' + e.message;
    }
  }
}
