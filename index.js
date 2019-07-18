const fs = require('fs');
const { resolve } = require('path');
const cp = require('child_process');

const puppeteer = require('puppeteer');
const webpack = require('webpack');
const mkdirp = require('mkdirp');
const inquirer = require('inquirer');
const { push } = require('aemsync');

const buildDirectory = resolve(__dirname, 'dist');
const templateDirectory = resolve(__dirname, 'templates');
const contentFile = fs.readFileSync(`${templateDirectory}/.content.xml`, 'utf8');
const versionedComponentContentFile = fs.readFileSync(`${templateDirectory}/component/.content.xml`, 'utf8');
const versionedContentFile = fs.readFileSync(`${templateDirectory}/component/v1/.content.xml`, 'utf8');
const componentContentDialogFile = fs.readFileSync(`${templateDirectory}/component/v1/component/_cq_dialog/.content.xml`, 'utf8');
const componentContentFile = fs.readFileSync(`${templateDirectory}/component/v1/component/.content.xml`, 'utf8');
const componentHtmlFile = fs.readFileSync(`${templateDirectory}/component/v1/component/component.html`, 'utf8');

// headless browser

const UpperCase = c => c.charAt(0).toUpperCase() + c.slice(1);
const req = async module => {
  try {
    require.resolve(module);
  } catch (e) {
    cp.execSync(`npm install ${module} --no-save`);
    await setImmediate(() => {});
  }

  try {
    return require.resolve(module);
  } catch (e) {
    console.log(`Could not require "${module}".`);
    process.exit(0);
  }
}

const questions = [
  {
    type: 'input',
    name: 'module',
    message: 'Enter a module or file you wish to transpile:',
  },
  {
    type: 'input',
    name: 'group',
    message: 'Enter a component group for your library:',
  },
  {
    type: 'confirm',
    name: 'versioned',
    message: 'Do you wish to use versioned clientlibs?',
  },
  {
    type: 'input',
    name: 'project',
    message: 'Enter an AEM app directory (optionally):',
  },
];

inquirer.prompt(questions).then(async ({ module, group, versioned, project }) => {

  const path = await req(module);

  // Bundle the script with Webpack
  await new Promise(resolve => webpack({ entry: path }, resolve));

  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  // Magic
  await page.addScriptTag({ content: `
    const origDefine = window.customElements.define;
    window.customElementList = {};
    window.customElements.define = (n, c, o) => window.customElementList[n] = c.observedAttributes;` });
  await page.addScriptTag({ path: `${buildDirectory}/main.js` });

  // Extract the results from the page
  const customElements = await page.evaluate(() => window.customElementList);
  browser.close();

  fs.unlinkSync(`${buildDirectory}/main.js`);

  if (Object.keys(customElements).length > 0) {
    try {
      const directory = (project !== ''
        ? `${buildDirectory}/jcr_root/apps/${project}/components/content/${module}`
        : `${buildDirectory}/${module}`
      );

      mkdirp.sync(directory);

      fs.writeFileSync(`${directory}/.content.xml`, contentFile);

      for (customElement in customElements) {
        console.log(`Creating ${customElement}.`);

        const key = customElement;
        const name = (a => { return a.shift(), a.join('-')})(key.split('-'));
        const attributes = customElements[customElement];

        let componentDirectory = `${directory}/${name}`;

        // Create component directory
        mkdirp.sync(componentDirectory);

        if (versioned) {
          fs.writeFileSync(`${componentDirectory}/.content.xml`, versionedComponentContentFile);

          mkdirp.sync(`${componentDirectory}/v1`);

          fs.writeFileSync(`${componentDirectory}/v1/.content.xml`,
            versionedContentFile.replace(/\{component\}/g, name)
          );

          componentDirectory = `${directory}/${name}/v1/${name}`;

          mkdirp.sync(componentDirectory);
        }

        fs.writeFileSync(`${componentDirectory}/.content.xml`, contentFile);


        // # generate .content.xml file
        fs.writeFileSync(`${componentDirectory}/.content.xml`,
          componentContentFile
            .replace(/\{title\}/g, UpperCase(name))
            .replace(/\{group\}/g, group));

        // # generate component.html file
        fs.writeFileSync(
          `${componentDirectory}/${name}.html`,
          componentHtmlFile
            .replace(/\{tag\}/g, key)
            .replace(/\{attributes\}/g, attributes.map(attr => `${attr}="\$\{properties.${attr}\}"`).join(`
  `))
        );

        mkdirp.sync(`${componentDirectory}/_cq_dialog`);

        // # generate _cq_dialog/.content.xml file
        fs.writeFileSync(
          `${componentDirectory}/_cq_dialog/.content.xml`,
          componentContentDialogFile
            .replace(/\{title\}/g, UpperCase(name))
            .replace(/\{attributes\}/g, attributes.map(attr => `<${attr}
                                                jcr:primaryType="nt:unstructured"
                                                sling:resourceType="granite/ui/components/coral/foundation/form/textfield"
                                                fieldLabel="${UpperCase(attr)}"
                                                name="./${attr}"/>`).join(`
                                            `))
        );
      }

      if (project) {
        await push(directory, {
          targets: [
            'http://admin:admin@localhost:4502'
          ]
        });
      }

    } catch(e) {
      console.log(e);
    }
  } else {
    console.log(`No custom elements found in ${module}.`);
  }
});
