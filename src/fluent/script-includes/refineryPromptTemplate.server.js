var RefineryPromptTemplate = Class.create();
RefineryPromptTemplate.prototype = {
    initialize: function () {
    },

    type: 'RefineryPromptTemplate'
};

/**
 * Looks up a x_snc_kb_refinery_prompt_template row by `name` and substitutes
 * every {{var}} token in its `template` field from `values`. Mirrors
 * AI Group Chat's AIGCPromptTemplate.render (same table shape, same
 * substitution convention).
 *
 * @param {string} name
 * @param {Object} [values]
 * @returns {string} the rendered prompt text.
 */
RefineryPromptTemplate.render = function (name, values) {
    var templateGr = new GlideRecordSecure('x_snc_kb_refinery_prompt_template');
    templateGr.addQuery('name', name);
    templateGr.query();
    if (!templateGr.next()) {
        throw new Error('Prompt template "' + name + '" not found.');
    }

    var template = templateGr.getValue('template');
    if (gs.nil(template)) {
        throw new Error('Prompt template "' + name + '" has no template text.');
    }

    values = values || {};
    var rendered = template.replace(/\{\{(\w+)\}\}/g, function (match, key) {
        return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
    });

    var unresolved = rendered.match(/\{\{\w+\}\}/);
    if (unresolved) {
        throw new Error('Prompt template "' + name + '" has an unresolved placeholder: ' + unresolved[0]);
    }

    return rendered;
};
