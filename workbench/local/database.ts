import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const directory=process.env.FRIESGO_DATA_DIR||path.join(path.dirname(fileURLToPath(import.meta.url)),'data');
mkdirSync(directory,{recursive:true,mode:0o700});
export const databasePath=path.join(directory,'friesgo.sqlite');
const sqlite=new DatabaseSync(databasePath);
sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
sqlite.exec(`CREATE TABLE IF NOT EXISTS records(key TEXT PRIMARY KEY NOT NULL,kind TEXT NOT NULL,data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS records_kind_idx ON records(kind);
CREATE TABLE IF NOT EXISTS import_batches(id TEXT PRIMARY KEY NOT NULL,hash TEXT NOT NULL,summary TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_events(id TEXT PRIMARY KEY NOT NULL,entity_key TEXT NOT NULL,action TEXT NOT NULL,actor TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS audit_time_idx ON audit_events(created_at DESC,id DESC);`);
class Statement {
  constructor(public sql:string,public args:any[]=[]){}
  bind(...args:any[]){return new Statement(this.sql,args);}
  async first<T=any>():Promise<T|null>{return (sqlite.prepare(this.sql).get(...this.args) as T)||null;}
  async all<T=any>():Promise<{results:T[]}>{return {results:sqlite.prepare(this.sql).all(...this.args) as T[]};}
  async run(){return sqlite.prepare(this.sql).run(...this.args);}
}
export const env={DB:{prepare:(sql:string)=>new Statement(sql),batch:async(statements:Statement[])=>{
  sqlite.exec('BEGIN IMMEDIATE');
  try{const values=statements.map(s=>sqlite.prepare(s.sql).run(...s.args));sqlite.exec('COMMIT');return values;}
  catch(error){sqlite.exec('ROLLBACK');throw error;}
}}};
export function closeDatabase(){sqlite.close();}
