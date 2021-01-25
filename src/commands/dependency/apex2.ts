import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError, fs, MyDomainResolver } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
// import { createCanvas } from "canvas";
import * as jsonToDot from 'json-to-dot';
import { exec } from 'child_process';
import * as open from 'open';
import * as d3 from 'd3';
import { access } from "fs";
import * as cors from 'cors';
import * as bodyParser from 'body-parser';
import * as express from 'express';
import htmlBody from '../../services/test.html';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("first_plugin", "org");

export default class Data extends SfdxCommand {
  public static description = messages.getMessage("commandDescription");
  public algorithm: string;

  public static examples = [
    `$ sfdx dependency:apex --targetusername myOrg@example.com --targetdevhubusername devhub@org.com
    // build dependency graph for all Apex classes
  `,
    `$ sfdx dependency:apex --targetusername myOrg@example.com --targetdevhubusername devhub@org.com --prefix 'Test_'
    // build dependency graph for all Apex classes with Prefix 'Test_'
  `
  ];

  public static args = [{ name: "prefix" }, { name: 'algorithm' }];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    name: flags.string({
      char: "n",
      description: messages.getMessage("nameFlagDescription")
    }),
    force: flags.boolean({
      char: "f",
      description: messages.getMessage("forceFlagDescription")
    }),
    prefix: flags.string({
      char: "p",
      description: 'Prefix'
    }),
    algorithm: flags.string({
      char: "a",
      description: 'Algorithm for graph rendering (dot, fdp)'
    })
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  public async run(): Promise<AnyJson> {
    const prefix = this.flags.prefix;
    this.algorithm = this.flags.algorithm || 'dot';

    this.ux.startSpinner(`Querying classes with prefix '${prefix}'`);

    const app = express();
    const port = 3000

    app.use(bodyParser.urlencoded({ extended: false }));
    app.use(bodyParser.json());
    app.use(cors());

    app.get('/', (req, res) => {
      let page = JSON.parse(req.query.dotResult);
      res.send(JSON.stringify(page, null, 2));
    })
    app.post('/', async (req, res) => {
      const searchTerm = req.body.term;

      this.algorithm = this.flags.algorithm || 'dot';

      this.ux.startSpinner(`Querying classes with prefix '${searchTerm}'`);
      const conn = this.org.getConnection();
      const classQuery = `SELECT Id, Name FROM ApexClass` + (searchTerm ? ` WHERE Name LIKE '%${searchTerm}%'` : '');
      const classResult = await conn.query(classQuery);
      this.handleQueryResult(classResult);
  
      const classes = <ApexClass[]>classResult.records || [];
      const ids = new Set();
      for (const cl of classes) {
        ids.add(cl.Id);
      }
  
      const dependencyQuery = `                
          SELECT Id,MetadataComponentName,MetadataComponentId,MetadataComponentType,RefMetadataComponentId,RefMetadataComponentName,RefMetadataComponentType
          FROM MetadataComponentDependency
          WHERE RefMetadataComponentType = 'ApexClass'` + (ids.size ? `AND (MetadataComponentType = 'ApexClass' OR MetadataComponentType = 'ApexTrigger') AND RefMetadataComponentId IN ('${Array.from(ids).join('\',\'')}')` : ``)
        ;
  
      const dependencyResult = await conn.tooling.query(dependencyQuery);
      if (dependencyResult.totalSize >= 2000) {
        this.ux.warn('possible max result is exeeded');
      } else {
        this.ux.log(`Total Dependencies: ${dependencyResult.totalSize}`);
      }
  
      const dependencies = <Dependency[]>dependencyResult.records;
      const depP = dependencies.map(dep => Object.assign({
        source: dep.MetadataComponentName,
        target: dep.RefMetadataComponentName,
        value: 1
      }));
  
      const nodes = Array.from(new Set(depP.reduce((acc: Dependency[], val) => acc.concat([val.source, val.target]), []))).map((node: string, index) => Object.assign({
        id: node, group: node.endsWith('Test') ? 2 :
          node.includes('Handler') ? 3 :
            node.includes('Selector') ? 4 :
              node.includes('Service') ? 5 :
                1
      }));
  
      const graph = {};
      for (const { source, target } of depP) {
        if (!(source in graph)) {
          graph[source] = [];
        }
  
        graph[source].push(target);
      }


      const dotResult = jsonToDot(graph);

      await fs.writeFile('./out.dot', dotResult);

      await new Promise((res, rej) => exec(`dot -Tsvg ./out.dot -o ./out.svg`, (error) => !error ? res() : rej()));

      const buffer = await fs.readFile('./out.svg');

      this.ux.log('result ready');
      res.send(buffer.toString('base64'));
    })

    app.listen(port, async () => {
      console.log(`Example app listening at http://localhost:${port}`)
      await fs.writeFile('./tmp.html', htmlBody);

      open('./tmp.html');
    })
    return '';
  }

  handleQueryResult(result) {
    if (!result.totalSize && (!result.records || result.records.length <= 0)) {
      throw new SfdxError(
        messages.getMessage("errorNoOrgResults", [this.org.getOrgId()])
      );
    }
  }
}
interface ApexClass {
  Name: string;
  Id: string;
}
interface Dependency {
  Id: string;
  MetadataComponentName: string;
  MetadataComponentId: string;
  MetadataComponentType: string;
  RefMetadataComponentId: string;
  RefMetadataComponentName: string;
  RefMetadataComponentType: string;
}