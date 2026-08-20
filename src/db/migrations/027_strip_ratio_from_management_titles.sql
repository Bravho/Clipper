-- Migration 027: drop the aspect-ratio suffix from transferred video titles
--
-- Transferring one generated export into วิดิโอของคุณ used to name the row
-- `"<project title> · <variant>"`, where the variant is usually just an aspect
-- ratio ("4:5", "16:9", "9:16", "1:1"). That put a technical detail of the file
-- inside a user-facing, editable field which is then carried into the publish
-- composer and, for YouTube, into the public video title. The ratio is already
-- shown as card metadata, so the suffix was redundant everywhere it appeared.
--
-- ManagementTransferService no longer writes it (see transferredVideoTitle);
-- this cleans up the rows created before that change. Titles the user has since
-- edited by hand are not special-cased: the pattern only matches a trailing
-- " · <n>:<n>", which no human would type at the end of a title.
--
-- Deliberately narrow: a NAMED variant ("· Travy") is kept, because it is the
-- only thing distinguishing two otherwise identical rows. Idempotent — running
-- it twice matches nothing the second time.

UPDATE management_content_items
SET title = regexp_replace(title, '\s*·\s*[0-9]{1,2}\s*[:x/]\s*[0-9]{1,2}\s*$', ''),
    updated_at = NOW()
WHERE title ~ '\s*·\s*[0-9]{1,2}\s*[:x/]\s*[0-9]{1,2}\s*$';
