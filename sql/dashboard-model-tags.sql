-- Fan knowledge dashboard (workstream 6). Read only: the report of the model tag pass.
select asked, found, labels, rejected, cost_usd::float8 as cost_usd, last_asked::text as last_asked
from public.feed_model_tag_report()
