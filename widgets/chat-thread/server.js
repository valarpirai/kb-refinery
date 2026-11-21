/**
 * Chat turn: RAG search (RefineryAssistantRag.search -- see its own file
 * for the real sn_search.RAGRetrievalAPI call and its KB_SOURCES registry;
 * `kbSource` comes straight from the widget's own `kbSource` prop, driven
 * by pages/ask's source picker) + a synchronous LLM call
 * (RefineryLLM.dispatchSync -- see that file's own doc comment on the
 * confirmed-vs-guessed parts of its response handling).
 *
 * Deliberately stateless server-side: the client sends its own running
 * `history` (this widget's in-memory message list) on every turn rather
 * than this server script persisting a thread anywhere. Fine for a mockup;
 * revisit if this ever needs to survive a page reload.
 */

var MAX_HISTORY_TURNS = 8;
var MAX_SOURCES = 5;

export default function server(data, _options, input) {
  var action = (input && input.action) || 'ask';
  if (action !== 'ask') {
    data.isError = true;
    data.errorMessage = gs.getMessage('Unknown action: {0}', [String(action)]);
    return;
  }

  var message = ((input && input.message) || '').trim();
  if (!message) {
    data.isError = true;
    data.errorMessage = gs.getMessage('Message is required');
    return;
  }

  var history = Array.isArray(input && input.history) ? input.history : [];
  var kbSource = (input && input.kbSource) || RefineryAssistantRag.DEFAULT_KB_SOURCE;

  var sources = [];
  try {
    sources = RefineryAssistantRag.search(message, MAX_SOURCES, kbSource) || [];
  } catch (e) {
    gs.error('[Refinery] chat-thread ask: RAG search failed: ' + e.message);
    sources = [];
  }

  var prompt = _buildPrompt(message, history, sources);

  var reply;
  try {
    reply = RefineryLLM.dispatchSync({ promptText: prompt });
  } catch (e) {
    gs.error('[Refinery] chat-thread ask: LLM call failed: ' + (e && e.message ? e.message : e));
    data.isError = true;
    data.errorMessage = gs.getMessage('Failed to get a reply') + '.';
    return;
  }

  data.reply = reply;
  data.sources = sources;
}

/**
 * One self-contained prompt string per turn -- the whole conversation so
 * far, any RAG context, and the new question -- rather than the skill's
 * separate chatHistory payload shape. RefineryLLM.dispatchBatch's
 * chatHistory path is confirmed to work for *async* dispatch, but a plain
 * promptText string is this app's only shape confirmed all the way through
 * to a parsed reply (see refineryLLMCallback.server.js), so it's the safer
 * choice while RefineryLLM.dispatchSync's own response handling is still
 * unverified for this skill (see that function's doc comment).
 */
function _buildPrompt(message, history, sources) {
  var lines = [];
  lines.push(
    'You are a helpful workplace assistant. Answer the user\'s latest question '
      + 'using ONLY the reference material below (from a knowledge base search) -- '
      + 'do not use any outside or general knowledge, and do not invent, assume, or '
      + 'add any detail that is not explicitly stated in the reference material. Use '
      + 'the conversation so far only to understand what is being asked, never as a '
      + 'source of facts. Use plain, well-formatted Markdown, and cite sources by '
      + 'their [n] number. If the reference material does not contain the answer, '
      + 'say so plainly rather than guessing or filling in from general knowledge.'
  );

  var recentHistory = history.slice(-1 * MAX_HISTORY_TURNS * 2);
  if (recentHistory.length) {
    lines.push('');
    lines.push('Conversation so far:');
    for (var i = 0; i < recentHistory.length; i++) {
      var turn = recentHistory[i];
      var role = turn && turn.role === 'assistant' ? 'Assistant' : 'User';
      lines.push(role + ': ' + String((turn && turn.content) || ''));
    }
  }

  if (sources.length) {
    lines.push('');
    lines.push('Reference material (from a knowledge search):');
    for (var j = 0; j < sources.length; j++) {
      var src = sources[j];
      lines.push('[' + (j + 1) + '] ' + (src.title || src.number || 'Untitled') + ': ' + (src.snippet || ''));
    }
  } else {
    lines.push('');
    lines.push('No matching reference material was found for this question.');
  }

  lines.push('');
  lines.push('User: ' + message);

  return lines.join('\n');
}
