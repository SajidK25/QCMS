/* eslint-disable no-console */
/* eslint-disable no-param-reassign */
const httpStatus = require('http-status');
const { ArabicServices } = require('arabic-services');
const { logger } = require('../config/logger');
const { Sequelize, Op, Verse, sequelize } = require('../models');
const ApiError = require('../utils/ApiError');
const wordsServices = require('./words.service');
// const sphql = require('../config/sphinxql');

const getAyatInfo = async (ayatText, ayaNo, suraNo) => {
  if (suraNo === 0 || suraNo === null) suraNo = false;
  if (ayaNo === 0 || ayaNo === null) ayaNo = false;
  try {
    const isEnglishInput = /^[a-zA-Z\s]*$/.test(ayatText);
    const searchColumn = isEnglishInput ? 'englishTranslation' : 'emlaeyTextNoDiacritics';

    const verses = await Verse.findAll({
      attributes: [
        [
          Sequelize.fn(
            'concat',
            Sequelize.col('suraNo'),
            ':',
            Sequelize.col('ayaNo'),
            '-',
            Sequelize.col('suraNameAr'),
            '-',
            Sequelize.col('suraNameEn')
          ),
          'suraAyaInfo',
        ],
        'suraNo',
        'ayaNo',
        'uthmaniTextDiacritics',
        'emlaeyTextNoDiacritics',
        'englishTranslation',
      ],
      where: {
        [searchColumn]: {
          [Op.like]: `%${ArabicServices.removeTashkeel(ayatText)}%`,
        },
        ...(ayaNo && { ayaNo }),
        ...(suraNo && { suraNo }),
      },
    });

    return verses;
  } catch (error) {
    logger.error(error);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Query did not executed well`);
  }
};

const getAyaatBySuraAndAyaId = (suraNo, ayaNo) => {
  return Verse.findAll({
    attributes: [
      [
        Sequelize.fn(
          'concat',
          Sequelize.col('suraNo'),
          ':',
          Sequelize.col('ayaNo'),
          '-',
          Sequelize.col('suraNameAr'),
          '-',
          Sequelize.col('suraNameEn')
        ),
        'suraAyaInfo',
      ],
      'suraNo',
      'ayaNo',
      'uthmaniTextDiacritics',
      'emlaeyTextNoDiacritics',
      'englishTranslation',
    ],
    where: {
      ...(suraNo && { suraNo }),
      ...(ayaNo && { ayaNo }),
    },
  });
};

const searchAyatUsingTerm = async (rootTerm) => {
  try {
    const wordsDiscvrdUsngRoot = await wordsServices.getWordsUsingRoot(rootTerm); // words
    const conceptArabicList = [...new Set(wordsDiscvrdUsngRoot.map((item) => item.wordsInSI))];
    if (conceptArabicList.length === 0) {
      throw new ApiError(httpStatus.NOT_FOUND, `No Root Matched`);
    }
    const surahAndAyaList = await wordsServices.getSurahAndAyaByCncptArabicWords(conceptArabicList); // khadija and verses
    return { surahAndAyaList, conceptArabicList };
  } catch (error) {
    logger.error(error);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Query did not executed well`);
  }
};

const searchAyatUsingTermAndWords = async (conceptArabicList) => {
  try {
    const surahAndAyaList = await wordsServices.getSurahAndAyaByCncptArabicWords(conceptArabicList);
    return { surahAndAyaList, conceptArabicList };
  } catch (error) {
    logger.error(error);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Query did not executed well`);
  }
};

const getAyaAndSuraUsingCncptArabic = async (lemmas) => {
  const query = `
    SELECT 
      CONCAT(v."suraNo", ':', v."ayaNo", ' - ', v."suraNameAr", ' - ', v."suraNameEn") AS "suraAyaInfo", 
      v."suraNo",
      v."ayaNo",
      v."suraNameEn",
      v."suraNameAr",
      v."uthmaniTextDiacritics",
      v."emlaeyTextNoDiacritics",
      v."englishTranslation",
      STRING_AGG(DISTINCT m."word", ', ') AS "uniqueWords",
      COUNT(DISTINCT m."Lemma") AS "unique_lemma_count"
    FROM 
      "Mushaf" m 
    JOIN 
      "Verses" v 
    ON 
      v."suraNo" = m."Chapter" AND v."ayaNo" = m."Verse"
    WHERE 
      m."Lemma" IN (:lemmas)
    GROUP BY 
      v."suraNo",
      v."ayaNo",
      v."suraNameEn",
      v."suraNameAr",
      v."uthmaniTextDiacritics",
      v."emlaeyTextNoDiacritics",
      v."englishTranslation"
    ORDER BY 
      "unique_lemma_count" DESC, v."suraNo", v."ayaNo";
  `;

  const results = await sequelize.query(query, {
    replacements: { lemmas: lemmas.map((l) => l.lemma) },
    type: sequelize.QueryTypes.SELECT,
  });

  return results;
};

const getSuraAndAyaFromMushafUsingTerm = async (term) => {
  const lemmaList = await wordsServices.getSuggestedWordsBasedOnTerm(term);
  const lemmaNotFound = [...new Set(lemmaList.map((ll) => ll.lemma === null && ll.t))];
  const resultz = await getAyaAndSuraUsingCncptArabic(lemmaList);
  const conceptArabicList = [...new Set(resultz.flatMap((item) => item.uniqueWords.split(',').map((word) => word.trim())))];
  const surahAndAyaList = resultz.map(({ uniqueWords, ...otherFields }) => otherFields);
  return { surahAndAyaList, conceptArabicList, lemmaNotFound };
};

const getSuraAndAyaUsingWords = async (wordsArr) => {
  const results = await sequelize.query(
    `
    SELECT 
      CONCAT(v."suraNo", ':', v."ayaNo", ' - ', v."suraNameAr", ' - ', v."suraNameEn") AS "suraAyaInfo",
      v."suraNo",
      v."ayaNo",
      v."suraNameEn", 
      v."suraNameAr", 
      v."uthmaniTextDiacritics", 
      v."emlaeyTextNoDiacritics", 
      v."englishTranslation",
      m."word",
      STRING_AGG(DISTINCT m."word", ', ') AS "uniqueWords",
      COUNT(DISTINCT m."Lemma") AS "unique_lemma_count"
    FROM "Mushaf" m
    JOIN "Verses" v ON m."Chapter" = v."suraNo" AND m."Verse" = v."ayaNo"
    WHERE m."word" IN (:wordsArr)
    GROUP BY 
      v."suraNo",
      v."ayaNo",
      v."suraNameEn", 
      v."suraNameAr", 
      v."uthmaniTextDiacritics", 
      v."emlaeyTextNoDiacritics", 
      v."englishTranslation",
      m."word"
    ORDER BY 
      "unique_lemma_count" DESC, v."suraNo", v."ayaNo";
  `,
    {
      replacements: { wordsArr },
      type: Sequelize.QueryTypes.SELECT,
    }
  );

  const conceptArabicList = [...new Set(results.map((item) => item.word))];
  const surahAndAyaList = results.map(({ word, ...otherFields }) => otherFields);

  return { surahAndAyaList, conceptArabicList };
};

module.exports = {
  getAyatInfo,
  searchAyatUsingTerm,
  searchAyatUsingTermAndWords,
  getAyaatBySuraAndAyaId,
  getSuraAndAyaFromMushafUsingTerm,
  getSuraAndAyaUsingWords,
};
