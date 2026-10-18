import { expect, test } from '@playwright/test';
import { openApp } from './helpers/app';

const SQL = `-- A MySQL script
CREATE TABLE \`customers\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`email\` varchar(255) NOT NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`email\` (\`email\`)
) ENGINE=InnoDB COMMENT='People who buy';

CREATE TABLE \`orders\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`customer_id\` int NOT NULL,
  PRIMARY KEY (\`id\`),
  CONSTRAINT \`orders_customer\` FOREIGN KEY (\`customer_id\`) REFERENCES \`customers\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT INTO \`customers\` VALUES (1, 'ada@example.com');
CREATE VIEW \`recent\` AS SELECT * FROM \`orders\`;
`;

test('importing SQL: paste a script, see what was found and skipped, and the tables arrive selected on the diagram', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'Schema' }).click();

  await page.getByRole('button', { name: 'Import SQL' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import SQL' });
  await dialog.getByLabel('SQL').fill(SQL);
  await expect(dialog.getByLabel('Database')).toContainText('Detected: MySQL and MariaDB');
  await expect(dialog.getByTestId('import-sql-found')).toHaveText('2 tables, 1 ref found.');
  await expect(dialog).toContainText('2 statements skipped: 1 INSERT, 1 CREATE VIEW');
  await dialog.getByRole('button', { name: 'Import 2 tables' }).click();

  const text = page.getByRole('combobox', { name: 'DBML' });
  await expect(text).toHaveValue(/Table customers \{/);
  await expect(text).toHaveValue(/delete: cascade/);
  await expect(page.getByTestId('schema-table-customers')).toHaveClass(/is-selected/);
  await expect(page.getByTestId('schema-table-orders')).toHaveClass(/is-selected/);
  await expect(page.getByTestId('schema-ref-orders-customers')).toBeAttached();
});
