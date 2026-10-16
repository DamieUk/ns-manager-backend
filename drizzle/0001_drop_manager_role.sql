-- The manager role is gone (only executive and employee remain). Any former manager becomes an
-- employee with the employee's default permissions — never silently promoted to executive.
UPDATE `users` SET `role` = 'employee', `permissions` = '[{"key":"PRODUCTS","action":"view"}]' WHERE `role` = 'manager';
