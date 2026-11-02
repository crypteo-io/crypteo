-- Moves the platform row to the cheaper default schedule only if an admin
-- never changed the tiers from the previous default.
UPDATE "PlatformSettings"
SET "feeTiers" = '[{"fromUsd":0,"percent":0.35},{"fromUsd":10000,"percent":0.25},{"fromUsd":50000,"percent":0.1}]'::jsonb
WHERE "feeTiers" = '[{"fromUsd":0,"percent":0.45},{"fromUsd":50000,"percent":0.3},{"fromUsd":250000,"percent":0.15}]'::jsonb;
