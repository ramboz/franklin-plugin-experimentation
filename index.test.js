/*
 * Copyright 2022 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-disable no-console, object-curly-newline */
import { assert, expect } from '@esm-bundle/chai';
import { readFile } from '@web/test-runner-commands';
import sinon from 'sinon';
import {
  DEFAULT_OPTIONS,
  getExperiment,
  getExperimentConfig,
  getInstantExperimentConfig,
  patchBlockConfig,
  preEager,
  postLazy,
  runExperiment,
} from './index';

function toClassName(val) {
  return val.toLowerCase().replace(/[^0-9a-z]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

const context = {
  getMetadata: sinon.stub().callsFake((val) => document.querySelector(`head>meta[name=${val}]`)?.content || ''),
  toClassName: sinon.stub().callsFake(toClassName),
  toCamelCase: sinon.stub().callsFake((val) => toClassName(val).replace(/-([a-z])/g, (g) => g[1].toUpperCase())),
};

describe('Experimentation Plugin', () => {
  beforeEach(() => {
  });

  afterEach(() => {
  });

  describe('#DEFAULT_OPTIONS', () => {
    it('set default options for the plugin', () => {
      expect(DEFAULT_OPTIONS).to.eql({
        basePath: '/experiments',
        configFile: 'manifest.json',
        metaTag: 'experiment',
        queryParameter: 'experiment',
        storeKey: 'hlx-experiments',
      });
    });
  });

  describe('#getExperiment', () => {
    it('returns the experiment name if there is one', async () => {
      document.head.innerHTML = await readFile({ path: './tests/head.experiment.html' });
      expect(getExperiment.call(context, 'experiment')).to.eql('foo');
    });

    it('returns null if there is no experiment', async () => {
      document.head.innerHTML = await readFile({ path: './tests/head.html' });
      expect(getExperiment.call(context, 'experiment')).to.eql(null);
    });

    it('returns null if client is a bot', async () => {
      document.head.innerHTML = await readFile({ path: './tests/head.experiment.html' });
      Object.defineProperty(window.navigator, 'userAgent', { value: 'bot', configurable: true });
      expect(getExperiment.call(context, 'experiment')).to.eql(null);
      Object.defineProperty(window.navigator, 'userAgent', { value: 'crawl', configurable: true });
      expect(getExperiment.call(context, 'experiment')).to.eql(null);
      Object.defineProperty(window.navigator, 'userAgent', { value: 'spider', configurable: true });
      expect(getExperiment.call(context, 'experiment')).to.eql(null);
    });
  });

  describe('#getExperimentConfig', () => {
    let fetch;

    beforeEach(() => {
      fetch = sinon.stub(window, 'fetch');
    });

    afterEach(() => {
      fetch.restore();
    });

    it('returns null if the fetching the config failed', async () => {
      fetch.callsFake(() => Promise.resolve({ ok: false }));
      expect(await getExperimentConfig.call(context, 'foo', DEFAULT_OPTIONS)).to.eql(null);
    });

    it('returns null if the response is not valid json', async () => {
      fetch.callsFake(() => Promise.resolve({ ok: true, json: () => Promise.reject() }));
      expect(await getExperimentConfig.call(context, 'foo', DEFAULT_OPTIONS)).to.eql(null);
    });

    it('returns null if parsing the config failed', async () => {
      fetch.callsFake(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
      expect(await getExperimentConfig.call(context, 'foo', DEFAULT_OPTIONS)).to.eql(null);
    });

    it('returns null if the config is not valid', async () => {
      fetch.callsFake(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          settings: { data: [{ Name: 'foo', Value: 'bar' }] },
          experiences: { data: [{ Name: 'baz', Value: 'qux' }] },
        }),
      }));
      expect(await getExperimentConfig.call(context, 'foo', DEFAULT_OPTIONS)).to.eql(null);
    });

    it('returns the config if it was available and is valid', async () => {
      const config = await readFile({ path: './tests/experiment.manifest.json' });
      fetch.callsFake(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(JSON.parse(config)),
      }));
      expect(await getExperimentConfig.call(context, 'foo', DEFAULT_OPTIONS)).to.eql({
        audience: 'Mobile',
        basePath: '/experiments/foo',
        experimentName: 'CCX 0074 Table of Contents',
        id: 'foo',
        manifest: '/experiments/foo/manifest.json',
        status: 'Inactive',
        variantNames: ['control', 'challenger-1', 'challenger-2'],
        variants: {
          'challenger-1': {
            blocks: ['blocks/toc1'],
            label: 'Downward arrow ToC',
            pages: [
              '/express/experiments/ccx0074/flyer-ch1',
              '/express/experiments/ccx0074/flyer-create-ch1',
            ],
            percentageSplit: '0.33',
          },
          'challenger-2': {
            blocks: ['blocks/toc2'],
            label: 'Dynamic pill ToC',
            pages: [
              '/express/experiments/ccx0074/flyer-ch2',
              '/express/experiments/ccx0074/flyer-create-ch2',
            ],
            percentageSplit: '0.33',
          },
          control: {
            blocks: ['toc'],
            label: 'Control',
            pages: [
              '/express/experiments/ccx0074/test',
              '/express/create/flyer',
            ],
            percentageSplit: '',
          },
        },
      });
    });
  });

  describe('#getInstantExperimentConfig', () => {
    it('returns the config for the specified single instant experiment', () => {
      expect(getInstantExperimentConfig('foo', 'https://bar.baz/qux')).to.eql({
        label: 'Instant Experiment: foo',
        audience: '',
        status: 'Active',
        id: 'foo',
        variantNames: ['control', 'challenger-1'],
        variants: {
          control: {
            percentageSplit: '',
            pages: [window.location.pathname],
            blocks: [],
            label: 'Control',
          },
          'challenger-1': {
            percentageSplit: '0.50',
            pages: ['/qux'],
            label: 'Challenger 1',
          },
        },
      });
    });

    it('returns the config for the specified multi-page instant experiment', () => {
      expect(getInstantExperimentConfig('foo', 'https://bar.baz/qux, https://corge.grault/waldo')).to.eql({
        label: 'Instant Experiment: foo',
        audience: '',
        status: 'Active',
        id: 'foo',
        variantNames: ['control', 'challenger-1', 'challenger-2'],
        variants: {
          control: {
            percentageSplit: '',
            pages: [window.location.pathname],
            blocks: [],
            label: 'Control',
          },
          'challenger-1': {
            percentageSplit: '0.33',
            pages: ['/qux'],
            label: 'Challenger 1',
          },
          'challenger-2': {
            percentageSplit: '0.33',
            pages: ['/waldo'],
            label: 'Challenger 2',
          },
        },
      });
    });
  });

  describe('#patchBlockConfig', () => {
    beforeEach(() => {
      window.hlx = { codeBasePath: '' };
    });

    it('returns the unchanged config if there is no experiment', () => {
      expect(patchBlockConfig({ blockName: 'foo' })).to.eql({ blockName: 'foo' });
    });

    it('returns the unchanged config if the current experiment is not running', () => {
      window.hlx.experiment = { run: false };
      expect(patchBlockConfig({ blockName: 'foo' })).to.eql({ blockName: 'foo' });
    });

    it('returns the unchanged config if the current experiment is the control group', () => {
      window.hlx.experiment = { run: true, selectedVariant: 'control', variantNames: ['control'] };
      expect(patchBlockConfig({ blockName: 'foo' })).to.eql({ blockName: 'foo' });
    });

    it('returns the unchanged config if the current experiment does not modify blocks', () => {
      window.hlx.experiment = { run: true, selectedVariant: 'challenger-1', variantNames: ['control', 'challenger-1'] };
      expect(patchBlockConfig({ blockName: 'foo' })).to.eql({ blockName: 'foo' });
    });

    it('returns the unchanged config if the current experiment does not modify this block', () => {
      window.hlx.experiment = { run: true, selectedVariant: 'challenger-1', variantNames: ['control', 'challenger-1'], blocks: ['bar'] };
      expect(patchBlockConfig({ blockName: 'foo' })).to.eql({ blockName: 'foo' });
    });

    it('returns the unchanged config if the current experiment does not modify this block', () => {
      window.hlx.experiment = {
        run: true,
        selectedVariant: 'challenger-1',
        blocks: ['foo'],
        variantNames: ['control', 'challenger-1'],
        variants: { 'challenger-1': { blocks: [] } },
      };
      expect(patchBlockConfig({ blockName: 'foo' })).to.eql({ blockName: 'foo' });
    });

    it('returns the unchanged config if the current variant does not modify this block', () => {
      window.hlx.experiment = {
        run: true,
        selectedVariant: 'challenger-1',
        blocks: ['foo'],
        variantNames: ['control', 'challenger-1'],
        variants: {
          control: { blocks: ['bar'] },
          'challenger-1': { blocks: ['bar'] },
        },
      };
      expect(patchBlockConfig({ blockName: 'foo' })).to.eql({ blockName: 'foo' });
    });

    it('returns the unchanged config if the current variant does not modify the experiment\'s block', () => {
      window.hlx.experiment = {
        run: true,
        selectedVariant: 'challenger-1',
        blocks: ['foo'],
        variantNames: ['control', 'challenger-1'],
        variants: {
          control: { blocks: ['bar'] },
          'challenger-1': { blocks: ['bar'] },
        },
      };
      expect(patchBlockConfig({ blockName: 'foo' })).to.eql({ blockName: 'foo' });
    });

    it('returns the unchanged config if the current variant does not modify a valid block', () => {
      window.hlx.experiment = {
        run: true,
        selectedVariant: 'challenger-1',
        blocks: ['foo'],
        variantNames: ['control', 'challenger-1'],
        variants: {
          control: { blocks: ['bar', 'foo'] },
          'challenger-1': { blocks: ['baz'] },
        },
      };
      expect(patchBlockConfig({ blockName: 'foo' })).to.eql({ blockName: 'foo' });
    });

    it('returns the config for the targeted relative block', () => {
      window.hlx.experiment = {
        run: true,
        selectedVariant: 'challenger-1',
        blocks: ['foo'],
        variantNames: ['control', 'challenger-1'],
        variants: {
          control: { blocks: ['foo'] },
          'challenger-1': { blocks: ['bar'] },
        },
      };
      expect(patchBlockConfig({ blockName: 'foo' })).to.eql({
        blockName: 'foo',
        cssPath: 'bar/foo.css',
        jsPath: 'bar/foo.js',
      });
    });

    it('returns the config for the targeted absolute block on the same origin', () => {
      window.hlx.experiment = {
        run: true,
        selectedVariant: 'challenger-1',
        blocks: ['foo'],
        variantNames: ['control', 'challenger-1'],
        variants: {
          control: { blocks: ['foo'] },
          'challenger-1': { blocks: [`${window.location.origin}/experiments/foo/blocks/bar`] },
        },
      };
      expect(patchBlockConfig({ blockName: 'foo' })).to.eql({
        blockName: 'foo',
        cssPath: '/experiments/foo/blocks/bar/foo.css',
        jsPath: '/experiments/foo/blocks/bar/foo.js',
      });
    });

    it('returns the config for the targeted absolute block on a different origin', () => {
      window.hlx.experiment = {
        run: true,
        selectedVariant: 'challenger-1',
        blocks: ['foo'],
        variantNames: ['control', 'challenger-1'],
        variants: {
          control: { blocks: ['foo'] },
          'challenger-1': { blocks: ['https://bar.hlx.live/blocks/foo'] },
        },
      };
      expect(patchBlockConfig({ blockName: 'foo' })).to.eql({
        blockName: 'foo',
        cssPath: 'https://bar.hlx.live/blocks/foo/foo.css',
        jsPath: 'https://bar.hlx.live/blocks/foo/foo.js',
      });
    });

    it('returns the config for the targeted block on a different origin', () => {
      window.hlx.experiment = {
        run: true,
        selectedVariant: 'challenger-1',
        blocks: ['foo'],
        variantNames: ['control', 'challenger-1'],
        variants: {
          control: { blocks: ['foo'] },
          'challenger-1': { blocks: ['https://bar.hlx.live'] },
        },
      };
      expect(patchBlockConfig({ blockName: 'foo' })).to.eql({
        blockName: 'foo',
        cssPath: 'https://bar.hlx.live/blocks/foo/foo.css',
        jsPath: 'https://bar.hlx.live/blocks/foo/foo.js',
      });
    });
  });

  describe('#runExperiment', () => {

  });

  describe('#preEager', () => {

  });

  describe('#postLazy', () => {

  });
});
