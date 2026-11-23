const express = require('express');
const createPageController = require('../controllers/pageController');
const createReportController = require('../controllers/reportController');
const createAdminController = require('../controllers/adminController');
const createContentController = require('../controllers/contentController');

module.exports = function createRoutes(dependencies) {
  const router = express.Router();
  router.use(createPageController(dependencies));
  router.use(createReportController(dependencies));
  router.use(createAdminController(dependencies));
  router.use(createContentController(dependencies));
  return router;
};
