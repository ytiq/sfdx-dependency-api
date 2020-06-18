import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError, fs } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
// import { createCanvas } from "canvas";
import * as jsonToDot from 'json-to-dot';
import {exec} from 'child_process';
import * as open from 'open';
import * as d3 from 'd3';
import { access } from "fs";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("first_plugin", "org");

export default class Data extends SfdxCommand {
  public static description = messages.getMessage("commandDescription");
  public algorithm: string;

  public static examples = [
    `$ sfdx hello:org --targetusername myOrg@example.com --targetdevhubusername devhub@org.com
  Hello world! This is org: MyOrg and I will be around until Tue Mar 20 2018!
  My hub org id is: 00Dxx000000001234
  `,
    `$ sfdx hello:org --name myname --targetusername myOrg@example.com
  Hello myname! This is org: MyOrg and I will be around until Tue Mar 20 2018!
  `
  ];

  public static args = [{ name: "prefix" }, {name: 'algorithm'}];

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
    // this.org is guaranteed because requiresUsername=true, as opposed to supportsUsername
    const conn = this.org.getConnection();
    const classQuery = `SELECT Id, Name FROM ApexClass` + (prefix? `WHERE Name LIKE '${prefix}%'` : '');

    // The type we are querying for

    // Query the org
    const classResult = await conn.query(classQuery);
    this.handleQueryResult(classResult);

    // Organization will always return one result, but this is an example of throwing an error
    // The output and --json will automatically be handled for you.
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

    // Organization always only returns one result
    const classes = <ApexClass[]>classResult.records || [];
    const ids = new Set();
    for(const cl of classes) {
        if (cl.Name.startsWith(prefix)) {
            ids.add(cl.Id);
        }
    }

    const dependencyQuery = `                
        SELECT Id,MetadataComponentName,MetadataComponentId,MetadataComponentType,RefMetadataComponentId,RefMetadataComponentName,RefMetadataComponentType
        FROM MetadataComponentDependency
        WHERE RefMetadataComponentType = 'ApexClass'` + (ids.size?`AND (MetadataComponentType = 'ApexClass' OR MetadataComponentType = 'ApexTrigger') AND RefMetadataComponentId IN ('${Array.from(ids).join('\',\'')}')` : ``)
    ;
    this.ux.log(dependencyQuery);

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
                       node.includes('Handler') ? 3:
                       node.includes('Selector') ? 4 :
                       node.includes('Service') ? 5 :
                       1
    }));

    const graph = {};
    for(const {source, target} of depP) {
        if (!(source in graph)) {
            graph[source] = [];
        }

        graph[source].push(target);
    }
    console.log('graph');


    const dotResult = jsonToDot(graph);
    this.createPngFile(dotResult);
    // fs.writeFile('./tmp.html', this.createHtmlFile({nodes, links: depP}))
    //   .then(() => {
    //     open('./tmp.html');
    //     console.log('done');
    //   })

    return JSON.stringify({ classes });
  }

  handleQueryResult(result) {
    if (!result.totalSize && (!result.records || result.records.length <= 0)) {
      throw new SfdxError(
        messages.getMessage("errorNoOrgResults", [this.org.getOrgId()])
      );
    }
  }
  openInBrowser(dotResult) {
    open(`https://dreampuf.github.io/GraphvizOnline/#${encodeURIComponent(dotResult)}`);
  }
  createPngFile(dotResult) {
    fs.writeFile('out.dot', dotResult)
        .then(() => {
          this.ux.log('execute');

            exec(`dot -K${this.algorithm} -Tpng out.dot -o out.png`, (error) => {
                if (error) {
                    this.ux.log('error' + error);
                    return;
                }
                exec('out.png', () => {
                  setTimeout(() => {
                    fs.unlink('out.dot');
                    fs.unlink('out.png');
                  }, 500);
                });
                this.ux.stopSpinner('all completed');
            });
        })
    ;
  }
  createHtmlFile(data) {
    return `
      <html>
        <head>
          <style>
            svg text {
              -webkit-user-select: none;
              -moz-user-select: none;
              -ms-user-select: none;
              user-select: none;
            }
          </style>
        </head>
        <body>
          <script src="https://cdnjs.cloudflare.com/ajax/libs/d3/5.14.2/d3.min.js"></script>
          <script>
            const data = JSON.parse('${JSON.stringify(data)}');
            data.nodes.forEach(node => node.adj = 0);
            const nodeMap = data.nodes.reduce((acc, node) => Object.assign(acc, {[node.id]: node}), {});
            data.links.forEach(link => {
              nodeMap[link.source].adj += 1;
              nodeMap[link.target].adj += 1;
            });
            
            const drag= simulation => {
  
              function dragstarted(d) {
                if (!d3.event.active) simulation.alphaTarget(0.3).restart();
                d.fx = d.x;
                d.fy = d.y;
              }
              
              function dragged(d) {
                d.fx = d3.event.x;
                d.fy = d3.event.y;
              }
              
              function dragended(d) {
                if (!d3.event.active) simulation.alphaTarget(0);
                d.fx = null;
                d.fy = null;
              }
              
              return d3.drag()
                  .on("start", dragstarted)
                  .on("drag", dragged)
                  .on("end", dragended);
            };

            color = function() {
              const scale = d3.scaleOrdinal(d3.schemeCategory10);
              return d => scale(d.group);
            }();

            height = 1200;
            width = 1200;
            
            chart = function() {
              const links = data.links.map(d => Object.create(d));
              const nodes = data.nodes.map(d => Object.create(d));
            
              const simulation = d3.forceSimulation(nodes)
                  .force("link", d3.forceLink(links).id(d => d.id).distance(d => {
                      const s =nodes[d.source.index].adj,
                      t = nodes[d.target.index].adj;
                      return 350/Math.sqrt(s*s + t*t*t);
                    }))
                  .force("charge", d3.forceManyBody())
                  .force("collide", d3.forceCollide(20).strength(0.3))
                  .force("center", d3.forceCenter(width / 2, height / 2));
            
              const svg = d3.create("svg")
                  .attr("viewBox", [0, 0, width, height]);
            
              svg.append("svg:defs").append("svg:marker")
                  .attr("id", "triangle")
                  .attr("refX", 17)
                  .attr("refY", 6)
                  .attr("markerWidth", 30)
                  .attr("markerHeight", 30)
                  .attr("orient", "auto")
                  .append("path")
                  .attr("d", "M 0 0 12 6 0 12 3 6")
                  .style("opacity", "0.6")
                  .style("fill", "black");

              const link = svg.append("g")
                  .attr("stroke", "#999")
                  .attr("stroke-opacity", 0.6)
                .selectAll("line")
                .data(links)
                .join("line")
                  .attr("stroke-width", d => Math.sqrt(d.value))
                  .attr("marker-end", "url('#triangle')");
            
              const text = svg.append("g")
                  .attr("stroke-width", 1.5)
                  .selectAll("text")
                  .data(nodes)
                  .join("text")
                    .attr("fill", "black")
                    .text(node => node.id);

              const node = svg.append("g")
                  .attr("stroke", "#fff")
                  .attr("stroke-width", 1.5)
                .selectAll("circle")
                .data(nodes)
                .join("circle")
                  .attr("r", 5)
                  .attr("fill", color)
                  .call(drag(simulation));

            
              node.append("title")
                  .text(d => d.id);
            
              simulation.on("tick", () => {
                link
                    .attr("x1", d => d.source.x)
                    .attr("y1", d => d.source.y)
                    .attr("x2", d => d.target.x)
                    .attr("y2", d => d.target.y);
            
                node
                    .attr("cx", d => d.x)
                    .attr("cy", d => d.y);
                text
                    .attr("x", d => d.x)
                    .attr("y", d => d.y - 10)
              });
            
              // invalidation(() => simulation.stop());
            
              return svg.node();
            }();

            document.body.appendChild(chart);
          </script>
          <h1>Hello World</h1>
        </body>
      </html>
    `
  }
}
