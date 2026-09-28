/**
 * Code.gs - Google Apps Script Backend for EF 69 Evaluation System
 * สำนักงานเขตพื้นที่การศึกษาประถมศึกษาน่าน เขต 1
 * Google Sheet ID: 1SixGKrITnWuAW5Ex6qZWVSt6MwhZ0DAO4JVcJRSMAeA
 * Upload Folder ID: 1nhD1UI4lE6Dox1VrFvKKDS9LbqqV_Y4I
 */

const SPREADSHEET_ID = '1SixGKrITnWuAW5Ex6qZWVSt6MwhZ0DAO4JVcJRSMAeA';
const UPLOAD_FOLDER_ID = '1nhD1UI4lE6Dox1VrFvKKDS9LbqqV_Y4I';
const EVALUATION_SHEETS = ['Evaluation_Supervisor', 'Evaluation_School', 'Evaluation_Teacher', 'Evaluation_Student', 'Evaluation_Parent'];

function doGet(e) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'info';

    // 1. ลบรายการข้อมูลการประเมิน (Delete Submission API - GET Mode for easy cross-origin access)
    if (action === 'delete_submission' || action === 'delete') {
      const targetId = (e && e.parameter && (e.parameter.id || e.parameter.submissionId)) ? String(e.parameter.id || e.parameter.submissionId).trim() : '';
      if (!targetId) {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'error',
          message: 'กรุณาระบุ Submission ID ที่ต้องการลบ'
        })).setMimeType(ContentService.MimeType.JSON);
      }

      let deletedCount = 0;
      const deletedFromSheets = [];

      EVALUATION_SHEETS.forEach(sheetName => {
        const sheet = ss.getSheetByName(sheetName);
        if (sheet && sheet.getLastRow() > 1) {
          const data = sheet.getDataRange().getValues();
          const headers = data[0];
          const idColIndex = headers.indexOf('Submission_ID');
          const checkCol = idColIndex >= 0 ? idColIndex : 0;

          // Loop from bottom to top to safely delete rows by index
          for (let r = data.length - 1; r >= 1; r--) {
            const rowId = String(data[r][checkCol] || '').trim();
            if (rowId === targetId) {
              sheet.deleteRow(r + 1);
              deletedCount++;
              if (deletedFromSheets.indexOf(sheetName) === -1) {
                deletedFromSheets.push(sheetName);
              }
            }
          }
        }
      });

      return ContentService.createTextOutput(JSON.stringify({
        status: deletedCount > 0 ? 'success' : 'not_found',
        message: deletedCount > 0 ? ('ลบข้อมูลรหัส ' + targetId + ' ออกจาก Google Sheet เรียบร้อยแล้ว (' + deletedCount + ' รายการ)') : ('ไม่พบข้อมูลรหัส ' + targetId + ' ใน Google Sheet'),
        deletedId: targetId,
        deletedCount: deletedCount,
        sheets: deletedFromSheets,
        timestamp: Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss')
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. ดึงรายการข้อมูลการประเมินทั้งหมด (Get Submissions)
    if (action === 'get_submissions') {
      const results = [];
      
      EVALUATION_SHEETS.forEach(sheetName => {
        const sheet = ss.getSheetByName(sheetName);
        if (sheet && sheet.getLastRow() > 1) {
          const data = sheet.getDataRange().getValues();
          const headers = data[0];
          const idColIndex = headers.indexOf('Submission_ID') >= 0 ? headers.indexOf('Submission_ID') : 0;

          for (let r = 1; r < data.length; r++) {
            const rawId = String(data[r][idColIndex] || '').trim();
            // กรองข้ามแถวที่ไม่มี Submission_ID หรือเป็นแถวว่าง
            if (!rawId) continue;

            const rowObj = {};
            for (let c = 0; c < headers.length; c++) {
              rowObj[headers[c]] = data[r][c];
            }
            rowObj['_sheet'] = sheetName;
            results.push(rowObj);
          }
        }
      });

      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        total: results.length,
        data: results
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 3. ดึงรายการรูปภาพและไฟล์แนบทั้งหมดจาก Google Drive Folder โดยตรง (Media Gallery API)
    if (action === 'get_files' || action === 'get_uploaded_files') {
      const filesList = [];
      try {
        const folder = DriveApp.getFolderById(UPLOAD_FOLDER_ID);
        const files = folder.getFiles();
        
        while (files.hasNext()) {
          const f = files.next();
          const fileId = f.getId();
          const mime = f.getMimeType();
          const isImg = mime.indexOf('image/') === 0;
          const isPdf = mime.indexOf('pdf') > -1;
          const isDoc = mime.indexOf('word') > -1 || mime.indexOf('document') > -1 || f.getName().endsWith('.doc') || f.getName().endsWith('.docx');
          
          filesList.push({
            id: fileId,
            name: f.getName(),
            mimeType: mime,
            size: f.getSize(),
            isImage: isImg,
            isPdf: isPdf,
            isDoc: isDoc,
            dateCreated: Utilities.formatDate(f.getDateCreated(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss'),
            lastUpdated: Utilities.formatDate(f.getLastUpdated(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss'),
            url: f.getUrl(),
            downloadUrl: 'https://drive.google.com/uc?export=download&id=' + fileId,
            previewUrl: 'https://drive.google.com/file/d/' + fileId + '/preview',
            thumbnailUrl: isImg ? ('https://drive.google.com/thumbnail?id=' + fileId + '&sz=w800') : ''
          });
        }
      } catch (driveErr) {
        Logger.log('Drive List Error: ' + driveErr.toString());
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        folderId: UPLOAD_FOLDER_ID,
        folderUrl: 'https://drive.google.com/drive/folders/' + UPLOAD_FOLDER_ID,
        total: filesList.length,
        data: filesList
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 4. แสดงสถานะระบบ
    return ContentService.createTextOutput(JSON.stringify({
      status: 'online',
      message: 'ระบบประเมิน EF 69 สพป.น่าน เขต 1 เชื่อมต่อสำเร็จ',
      spreadsheetId: SPREADSHEET_ID,
      uploadFolderId: UPLOAD_FOLDER_ID,
      folderUrl: 'https://drive.google.com/drive/folders/' + UPLOAD_FOLDER_ID,
      timestamp: Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss')
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    const rawData = e.postData.contents;
    const data = JSON.parse(rawData);
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // 1. ตรวจสอบกรณีเป็นคำสั่งลบข้อมูล (Delete Request)
    if (data.action === 'delete_submission' || data.action === 'delete' || data.type === 'delete') {
      const targetId = String(data.id || data.submissionId || '').trim();
      if (!targetId) {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'error',
          message: 'กรุณาระบุ Submission ID ที่ต้องการลบ'
        })).setMimeType(ContentService.MimeType.JSON);
      }

      let deletedCount = 0;
      const deletedFromSheets = [];

      EVALUATION_SHEETS.forEach(sheetName => {
        const sheet = ss.getSheetByName(sheetName);
        if (sheet && sheet.getLastRow() > 1) {
          const sheetData = sheet.getDataRange().getValues();
          const headers = sheetData[0];
          const idColIndex = headers.indexOf('Submission_ID') >= 0 ? headers.indexOf('Submission_ID') : 0;

          for (let r = sheetData.length - 1; r >= 1; r--) {
            const rowId = String(sheetData[r][idColIndex] || '').trim();
            if (rowId === targetId) {
              sheet.deleteRow(r + 1);
              deletedCount++;
              if (deletedFromSheets.indexOf(sheetName) === -1) {
                deletedFromSheets.push(sheetName);
              }
            }
          }
        }
      });

      return ContentService.createTextOutput(JSON.stringify({
        status: deletedCount > 0 ? 'success' : 'not_found',
        message: deletedCount > 0 ? ('ลบข้อมูลรหัส ' + targetId + ' เรียบร้อยแล้ว') : ('ไม่พบข้อมูลรหัส ' + targetId),
        deletedId: targetId,
        deletedCount: deletedCount,
        sheets: deletedFromSheets
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. กรณีบันทึกข้อมูลแบบประเมินชุดใหม่
    const type = data.type || 'school';

    // Process Optional File / Photo Upload to Google Drive
    let attachmentUrl = data.attachmentUrl || '';
    let uploadedFileId = '';
    let uploadedThumbnailUrl = '';

    if (data.attachment && data.attachment.base64) {
      try {
        const folder = DriveApp.getFolderById(UPLOAD_FOLDER_ID);
        let base64Data = data.attachment.base64;
        if (base64Data.indexOf('base64,') > -1) {
          base64Data = base64Data.split('base64,')[1];
        }
        const decoded = Utilities.base64Decode(base64Data);
        const filePrefix = (data.schoolName ? data.schoolName + '_' : '') + (data.id || ('SUB-' + Date.now())) + '_';
        const rawFileName = data.attachment.name || 'document';
        const cleanFileName = filePrefix + rawFileName.replace(/[^a-zA-Z0-9ก-๙._-]/g, '_');
        const mimeType = data.attachment.type || 'application/octet-stream';
        
        const blob = Utilities.newBlob(decoded, mimeType, cleanFileName);
        const file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        
        uploadedFileId = file.getId();
        attachmentUrl = file.getUrl();
        if (mimeType.indexOf('image/') === 0) {
          uploadedThumbnailUrl = 'https://drive.google.com/thumbnail?id=' + uploadedFileId + '&sz=w800';
        }
      } catch (uploadErr) {
        Logger.log('Drive Upload Error: ' + uploadErr.toString());
      }
    }

    // 2. Select Sheet & Headers
    let targetSheetName = 'Evaluation_School';
    let headers = [];

    if (type === 'supervisor') {
      targetSheetName = 'Evaluation_Supervisor';
      headers = ['Submission_ID', 'Timestamp', 'Date', 'School_ID', 'School_Name', 'Group', 'District', 'Evaluator', 'Score_Total', 'Score_Avg', 'Quality_Level', 'Answers_JSON', 'Attachment_URL'];
    } else if (type === 'school') {
      targetSheetName = 'Evaluation_School';
      headers = ['Submission_ID', 'Timestamp', 'Date', 'School_ID', 'School_Name', 'Group', 'District', 'Evaluator', 'Score_Total', 'Score_Avg', 'Quality_Level', 'Answers_JSON', 'Attachment_URL'];
    } else if (type === 'teacher' || type === 'teacher_early' || type === 'teacher_primary') {
      targetSheetName = 'Evaluation_Teacher';
      headers = ['Submission_ID', 'Timestamp', 'Date', 'School_ID', 'School_Name', 'Group', 'District', 'Teacher_Level', 'Grade_Level', 'Teacher_Name', 'Score_Total', 'Score_Avg', 'Quality_Level', 'Answers_JSON', 'Attachment_URL'];
    } else if (type.startsWith('student_')) {
      targetSheetName = 'Evaluation_Student';
      headers = ['Submission_ID', 'Timestamp', 'Date', 'School_ID', 'School_Name', 'Group', 'District', 'Student_Level', 'Student_Name', 'Evaluator_Teacher', 'Score_Total', 'Score_Avg', 'Quality_Level', 'Answers_JSON'];
    } else if (type.startsWith('parent_')) {
      targetSheetName = 'Evaluation_Parent';
      headers = ['Submission_ID', 'Timestamp', 'Date', 'School_ID', 'School_Name', 'Group', 'District', 'Parent_Level', 'Parent_Name', 'Child_Name', 'Score_Total', 'Score_Avg', 'Quality_Level', 'Answers_JSON'];
    }

    let sheet = ss.getSheetByName(targetSheetName);
    if (!sheet) {
      sheet = ss.insertSheet(targetSheetName);
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#eff6ff');
    }

    const bangkokNow = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
    const bangkokDate = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');

    // Get current sheet headers to ensure exact column alignment
    const currentHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    const teacherStageThai = (data.teachingStage === 'early' || type.includes('early') || (data.gradeLevel && data.gradeLevel.startsWith('a'))) ? 'ปฐมวัย' : 'ประถม';
    const teacherGradeName = data.gradeLevelName || data.gradeLevel || '';

    // Ensure answers JSON contains metadata
    const answersObj = data.answers || {};
    if (data.teachingStage || type.includes('early') || type.includes('primary')) {
      answersObj['_meta_stage'] = data.teachingStage || (type.includes('early') ? 'early' : 'primary');
      answersObj['_meta_grade'] = data.gradeLevel || '';
      answersObj['_meta_grade_name'] = teacherGradeName;
    }

    let rowData = [];
    if (currentHeaders.length > 0 && currentHeaders[0] === 'Submission_ID') {
      // Map by header names if sheet already exists
      const valueMap = {
        'Submission_ID': data.id || 'SUB-' + Date.now(),
        'Timestamp': data.submittedAt || bangkokNow,
        'Date': data.date || bangkokDate,
        'School_ID': data.schoolId || '',
        'School_Name': data.schoolName || '',
        'Group': data.schoolGroup || '',
        'District': data.district || '',
        'Teacher_Level': teacherStageThai,
        'Teaching_Stage': teacherStageThai,
        'Student_Level': type.includes('early') ? 'ปฐมวัย' : 'ประถม',
        'Parent_Level': type.includes('early') ? 'ปฐมวัย' : 'ประถม',
        'Grade_Level': teacherGradeName,
        'Teacher_Name': data.evaluator || '',
        'Evaluator': data.evaluator || '',
        'Evaluator_Teacher': data.evaluator || '',
        'Student_Name': data.studentName || '',
        'Child_Name': data.studentName || '',
        'Parent_Name': data.evaluator || 'ไม่ระบุ',
        'Score_Total': data.scoreTotal || 0,
        'Score_Avg': data.scoreAvg || 0,
        'Quality_Level': data.qualityLevel || '',
        'Answers_JSON': JSON.stringify(answersObj),
        'Attachment_URL': attachmentUrl
      };

      rowData = currentHeaders.map(h => (valueMap[h] !== undefined ? valueMap[h] : ''));
    } else {
      // Fallback row building
      rowData = [
        data.id || 'SUB-' + Date.now(),
        data.submittedAt || bangkokNow,
        data.date || bangkokDate,
        data.schoolId || '',
        data.schoolName || '',
        data.schoolGroup || '',
        data.district || '',
        data.studentName ? (type.startsWith('student_') ? data.studentName : data.evaluator) : data.evaluator,
        data.scoreTotal || 0,
        data.scoreAvg || 0,
        data.qualityLevel || '',
        JSON.stringify(answersObj)
      ];

      if (type === 'supervisor' || type === 'school' || type === 'teacher' || type === 'teacher_early' || type === 'teacher_primary') {
        rowData.push(attachmentUrl);
      }

      if (type.startsWith('student_')) {
        rowData.splice(7, 0, type.includes('early') ? 'ปฐมวัย' : 'ประถม');
        rowData.splice(9, 0, data.evaluator || 'ครูผู้สอน');
      } else if (type.startsWith('parent_')) {
        rowData.splice(7, 0, type.includes('early') ? 'ปฐมวัย' : 'ประถม');
        rowData.splice(9, 0, data.studentName || '');
      } else if (type.startsWith('teacher')) {
        rowData.splice(7, 0, teacherStageThai);
        rowData.splice(8, 0, teacherGradeName);
      }
    }

    sheet.appendRow(rowData);

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      message: 'บันทึกข้อมูลลง Google Sheet เรียบร้อยแล้ว',
      submissionId: data.id,
      attachmentUrl: attachmentUrl,
      fileId: uploadedFileId,
      thumbnailUrl: uploadedThumbnailUrl
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
