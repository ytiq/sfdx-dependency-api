
const createPngFile = (dotResult) => {
    fs.writeFile('./out.dot', dotResult)
        .then(() => {
          this.ux.log('execute');

            exec(`dot -K${this.algorithm} -Tsvg ./out.dot -o ./out.svg`, (error) => {
                this.ux.log('plotted the file');
                if (error) {
                    this.ux.log('error' + error);
                    return;
                }
                exec('open ./out.svg', () => {
                  setTimeout(() => {
                    fs.unlink('out.dot');
                    // fs.unlink('out.png');
                  }, 500);
                });
                this.ux.stopSpinner('all completed');
            });
        })
    ;
  }

const express = require('express')
const bodyParser = require('body-parser');
const json2dot = require('json-to-dot');
const app = express();
const port = 3000
const {exec} = require('child_process');
const fs = require('fs/promises');
const { resolveSoa } = require('dns');
const cors = require('cors');

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors());

app.get('/', (req, res) => {
  let page = JSON.parse(req.query.dotResult);
  res.send(JSON.stringify(page, null, 2));
})
app.post('/', async (req, res) => {
    const className = req.body.term;
  const dotResult = json2dot(req.body.dotResult);
  
  await fs.writeFile('./out.dot', dotResult);

  await new Promise((res, rej) => exec(`dot -Tsvg ./out.dot -o ./out.svg`, (error) => !error ? res() : rej()));

  const buffer = await fs.readFile('./out.svg');

  res.send(buffer.toString('base64'));
})

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
})