-- +goose Up

-- How often the subscription bills: 'month' or 'year'. Subscriptions that
-- existed before yearly billing were all monthly.
ALTER TABLE users ADD COLUMN sub_interval TEXT;
UPDATE users SET sub_interval = 'month' WHERE sub_id IS NOT NULL;
