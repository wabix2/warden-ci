"use strict";
/**
 * Warden CI — popular-package seed lists.
 *
 * These are the packages worth protecting against impersonation: the ones
 * with enough real-world traffic that a name one typo away from them is a
 * plausible attack, and the ones LLMs are most likely to reference (and
 * therefore most likely to have a hallucinated near-miss invented near them).
 *
 * HONEST LIMITATION: this is a static, hand-curated list, not pulled from
 * live download-count data. It will drift out of date. The real version of
 * this — and the actual point-2 deliverable — is a scheduled job that
 * refreshes this list from registry download-count APIs (npm's
 * api.npmjs.org/downloads/point/last-month/{pkg} for a large candidate set,
 * PyPI's BigQuery public dataset for PyPI) so "popular" reflects reality,
 * not a snapshot from whenever this file was written. Shipping the static
 * list now so the typosquat check works today; the refresh job is the
 * next concrete piece of work, not a nice-to-have.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.POPULAR_PYPI_PACKAGES = exports.POPULAR_NPM_PACKAGES = void 0;
exports.POPULAR_NPM_PACKAGES = [
    "react", "react-dom", "vue", "angular", "svelte", "next", "nuxt",
    "express", "koa", "fastify", "nestjs", "@nestjs/core",
    "lodash", "underscore", "ramda", "moment", "dayjs", "date-fns",
    "axios", "node-fetch", "got", "request", "superagent",
    "chalk", "commander", "yargs", "inquirer", "ora",
    "webpack", "vite", "rollup", "parcel", "esbuild", "babel", "@babel/core",
    "eslint", "prettier", "typescript", "ts-node", "tsx",
    "jest", "mocha", "chai", "vitest", "cypress", "playwright",
    "express-session", "cookie-parser", "body-parser", "cors", "helmet",
    "mongoose", "sequelize", "prisma", "typeorm", "knex",
    "redis", "ioredis", "pg", "mysql", "mysql2", "sqlite3",
    "jsonwebtoken", "bcrypt", "bcryptjs", "passport", "passport-jwt",
    "dotenv", "config", "nconf",
    "socket.io", "ws", "sockjs",
    "uuid", "nanoid", "shortid",
    "rxjs", "zustand", "redux", "mobx", "recoil", "jotai",
    "styled-components", "tailwindcss", "sass", "less", "postcss",
    "classnames", "clsx",
    "graphql", "apollo-server", "@apollo/client",
    "aws-sdk", "@aws-sdk/client-s3", "firebase", "stripe", "twilio",
    "nodemailer", "multer", "sharp", "jimp",
    "winston", "pino", "morgan", "debug",
    "joi", "zod", "yup", "ajv",
    "puppeteer", "cheerio", "jsdom",
    "lint-staged", "husky", "concurrently", "nodemon", "pm2",
    "semver", "glob", "rimraf", "fs-extra", "chokidar",
    "async", "bluebird", "p-limit", "p-queue",
    "@octokit/rest", "@octokit/auth-app", "octokit",
    "chart.js", "d3", "three", "leaflet",
    "formik", "react-hook-form", "react-router", "react-router-dom",
    "immer", "reselect", "normalizr",
    "lru-cache", "node-cache", "memoize-one",
    "xml2js", "fast-xml-parser", "csv-parse", "papaparse",
];
exports.POPULAR_PYPI_PACKAGES = [
    "requests", "urllib3", "httpx", "aiohttp",
    "numpy", "pandas", "scipy", "matplotlib", "seaborn", "plotly",
    "django", "flask", "fastapi", "starlette", "tornado", "pyramid",
    "sqlalchemy", "alembic", "psycopg2", "pymongo", "redis",
    "pytest", "unittest2", "nose", "tox", "coverage",
    "boto3", "botocore", "google-cloud-storage", "azure-storage-blob",
    "pillow", "opencv-python", "scikit-image",
    "scikit-learn", "tensorflow", "torch", "keras", "xgboost", "lightgbm",
    "transformers", "sentence-transformers", "spacy", "nltk", "gensim",
    "beautifulsoup4", "lxml", "selenium", "scrapy",
    "click", "typer", "argparse", "fire",
    "pydantic", "marshmallow", "cerberus", "jsonschema",
    "celery", "rq", "dramatiq",
    "gunicorn", "uvicorn", "hypercorn", "waitress",
    "jinja2", "mako", "cheetah",
    "cryptography", "pyjwt", "passlib", "bcrypt", "oauthlib",
    "python-dotenv", "pyyaml", "toml", "configparser",
    "setuptools", "wheel", "pip", "virtualenv", "pipenv", "poetry",
    "black", "flake8", "pylint", "mypy", "isort", "ruff",
    "loguru", "structlog",
    "paramiko", "fabric", "invoke",
    "openpyxl", "xlrd", "xlsxwriter",
    "matplotlib", "bokeh", "altair",
    "networkx", "sympy", "statsmodels",
    "django-rest-framework", "djangorestframework", "graphene",
    "stripe", "twilio", "sendgrid", "boto",
];
