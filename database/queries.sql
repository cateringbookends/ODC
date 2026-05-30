-- Open events for Pre Cost Planning dropdown.
SELECT
  id,
  external_id,
  event_name,
  event_date,
  location,
  pax,
  status
FROM events
WHERE status != 'completed'
ORDER BY event_date ASC, event_name ASC;

-- Online invoice calculation with 5% GST.
SELECT
  e.id AS event_id,
  e.event_name,
  COALESCE(SUM(pc.amount), 0) AS online_subtotal,
  COALESCE(SUM(pc.amount), 0) * 0.05 AS gst_amount,
  COALESCE(SUM(pc.amount), 0) * 1.05 AS invoice_total
FROM events e
LEFT JOIN payment_cycles pc
  ON pc.event_id = e.id
  AND pc.billing_type = 'online'
WHERE e.id = :event_id
GROUP BY e.id, e.event_name;
