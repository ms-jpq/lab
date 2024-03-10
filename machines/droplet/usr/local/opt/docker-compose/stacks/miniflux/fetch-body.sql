UPDATE feeds
SET
  crawler = true
WHERE
  feed_url NOT LIKE 'https://youtube%';
