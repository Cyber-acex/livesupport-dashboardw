-- create_livesupport_user.sql
-- Replace StrongPasswordHere with a strong password before running.

CREATE DATABASE IF NOT EXISTS `livesupport`;

-- Create/grant for localhost (PHP/Apache default)
CREATE USER IF NOT EXISTS 'livesupport'@'localhost' IDENTIFIED BY 'localpass11';
GRANT ALL PRIVILEGES ON `livesupport`.* TO 'livesupport'@'localhost';

-- Create/grant for 127.0.0.1 (Node often connects via TCP to 127.0.0.1)
CREATE USER IF NOT EXISTS 'livesupport'@'127.0.0.1' IDENTIFIED BY 'localpass11';
GRANT ALL PRIVILEGES ON `livesupport`.* TO 'livesupport'@'127.0.0.1';

FLUSH PRIVILEGES;
