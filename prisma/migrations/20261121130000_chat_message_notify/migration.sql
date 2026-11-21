-- Tell listeners when an agent reply changes, so the chat can fetch it when there is news
-- instead of asking every second.
CREATE TRIGGER kb_change_chat_message AFTER INSERT OR UPDATE ON "ChatMessage" FOR EACH ROW EXECUTE FUNCTION kb_notify_change();
