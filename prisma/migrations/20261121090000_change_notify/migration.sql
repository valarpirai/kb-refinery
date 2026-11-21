-- Tell listeners when rows change, so the web server can push updates over SSE.
-- The payload names the table and the ids to refetch. It never carries row data.
-- A JobItem heartbeat is the only write that changes nothing a person can see, so it is skipped.

CREATE OR REPLACE FUNCTION kb_notify_change() RETURNS trigger AS $$
DECLARE
  cur jsonb;
  prev jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    cur := to_jsonb(OLD);
  ELSE
    cur := to_jsonb(NEW);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    prev := to_jsonb(OLD);
    IF (cur - 'heartbeatAt' - 'updatedAt') = (prev - 'heartbeatAt' - 'updatedAt') THEN
      RETURN NULL;
    END IF;
  END IF;

  PERFORM pg_notify(
    'kb_changes',
    jsonb_strip_nulls(jsonb_build_object(
      't', TG_TABLE_NAME,
      'id', cur->>'id',
      'job', CASE WHEN TG_TABLE_NAME = 'Job' THEN cur->>'id' ELSE cur->>'jobId' END,
      'article', CASE WHEN TG_TABLE_NAME = 'Article' THEN cur->>'id' ELSE cur->>'articleId' END,
      'user', cur->>'userId'
    ))::text
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER kb_change_job AFTER INSERT OR UPDATE OR DELETE ON "Job" FOR EACH ROW EXECUTE FUNCTION kb_notify_change();
CREATE TRIGGER kb_change_job_item AFTER INSERT OR UPDATE OR DELETE ON "JobItem" FOR EACH ROW EXECUTE FUNCTION kb_notify_change();
CREATE TRIGGER kb_change_stage_run AFTER INSERT ON "StageRun" FOR EACH ROW EXECUTE FUNCTION kb_notify_change();
CREATE TRIGGER kb_change_analysis AFTER INSERT OR UPDATE OR DELETE ON "Analysis" FOR EACH ROW EXECUTE FUNCTION kb_notify_change();
CREATE TRIGGER kb_change_article AFTER INSERT OR UPDATE OR DELETE ON "Article" FOR EACH ROW EXECUTE FUNCTION kb_notify_change();
CREATE TRIGGER kb_change_notification AFTER INSERT OR UPDATE ON "Notification" FOR EACH ROW EXECUTE FUNCTION kb_notify_change();
