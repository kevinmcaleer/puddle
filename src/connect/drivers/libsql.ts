// LibSQL: a local file is a SQLite file. Turso over HTTPS is #210.
import { sqliteConnector } from './sqlite';

export default sqliteConnector('libsql');
