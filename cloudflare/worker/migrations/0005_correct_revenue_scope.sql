-- 7,100,102元是寬承＋寬沐終端通路預估；採購成本率須使用寬承認列營收。
UPDATE procurement_month_plans
SET forecast_revenue = 5936068.44,
    source_note = '2026年9月中性情境：寬承預估認列營收5,936,068.44元；寬承＋寬沐終端通路預估7,100,102元只作營運參考。整月額度2,659,538.30元，已釋放額度1,329,769.15元。',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_by = 'system-scope-correction'
WHERE analysis_month = '2026-09';
