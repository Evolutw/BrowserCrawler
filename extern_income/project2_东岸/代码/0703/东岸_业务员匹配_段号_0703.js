// == 完整爬虫方案（动态页数版）==
(async function() {
    // ========== 初始化依赖加载 ==========
    try {
        if (!window.JSZip) {
            const script1 = document.createElement('script');
            script1.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
            document.head.appendChild(script1);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        if (!window.XLSX) {
            const script2 = document.createElement('script');
            script2.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
            document.head.appendChild(script2);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    } catch (e) {
        alert('依赖加载失败，请刷新页面重试');
        return;
    }

    // ========== 用户文件选择 ==========
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);

    let excelData = [], excelHeaders = [], excelMap = new Map();
    const allExcelKeys = new Set(); // 新增：记录所有Excel键
    
    try {
        const { headers, data } = await new Promise(resolve => {
            input.onchange = async function(e) {
                const file = e.target.files[0];
                const reader = new FileReader();
                reader.onload = function(e) {
                    try {
                        const workbook = XLSX.read(new Uint8Array(e.target.result), {type: 'array'});
                        const sheet = workbook.Sheets[workbook.SheetNames[0]];
                        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                        resolve({
                            headers: jsonData[0] || [],
                            data: jsonData.slice(1).filter(row => row.length > 0)
                        });
                    } catch (error) {
                        alert('Excel解析错误，请检查文件格式');
                        resolve({ headers: [], data: [] });
                    }
                };
                reader.readAsArrayBuffer(file);
            };
            input.click();
        });

        excelData = data;
        excelHeaders = headers.map((h, i) => h || '列' + (i + 1));
        
        // 使用姓名+证件号数字作为匹配键
        data.forEach(row => {
            if (row.length < 2) return;
            
            const name = String(row[0] || '').trim().toLowerCase();
            const id = String(row[1] || '').replace(/\D/g, '').toLowerCase();
            
            if (name && id) {
                const key = `${name}_${id}`;
                excelMap.set(key, row);
                allExcelKeys.add(key); // 记录所有Excel键
            }
        });
    } catch (e) {
        alert('Excel处理失败，请重试');
        return;
    } finally {
        if (input.parentNode) {
            document.body.removeChild(input);
        }
    }

    // ========== 配置区 ==========
    const CONFIG = {
        DELAY: 2000,            // 翻页延迟(毫秒)
        ZIP_PREFIX: '业务员数据', // 压缩包前缀
        PAGE_SIZE: 500,          // 每页显示数量（用于计算总页数）
        COLUMN_MAP: {           // 页面元素class映射
            姓名: 'el-table_2_column_8',
            证件号: 'el-table_2_column_9',
            业务员: 'el-table_2_column_20'
        }
    };

    // ========== 页数计算函数 ==========
    function calculateTotalPages() {
        const totalText = document.querySelector('.el-pagination__total')?.innerText || 
                         document.querySelector('.pagination-total')?.innerText ||
                         '0';
        const totalMatch = totalText.match(/[\d,]+/);
        const total = totalMatch ? parseInt(totalMatch[0].replace(/,/g, '')) : 0;
        return Math.ceil(total / CONFIG.PAGE_SIZE);
    }

    // ========== 数据提取函数 ==========
    function extractRowData(row) {
        function getCellValue(selector) {
            const cell = row.querySelector('td.' + selector + ' .cell');
            return cell ? cell.textContent.trim() : '';
        }

        const name = getCellValue(CONFIG.COLUMN_MAP.姓名).toLowerCase();
        const id = getCellValue(CONFIG.COLUMN_MAP.证件号).replace(/\D/g, '').toLowerCase();
        const salesman = getCellValue(CONFIG.COLUMN_MAP.业务员) || '未分配';

        if (!name || !id) return null;

        const key = `${name}_${id}`;
        return {
            webData: { name, id, salesman },
            excelRow: excelMap.get(key)
        };
    }

    // ========== 翻页抓取函数 ==========
    async function fetchAllPages() {
        const allRows = [];
        let currentPage = 1;
        const totalPages = calculateTotalPages();
        
        console.log(`📊 总页数: ${totalPages} (每页 ${CONFIG.PAGE_SIZE} 条)`);
        
        while (currentPage <= totalPages) {
            console.log(`⏳ 正在采集第 ${currentPage}/${totalPages} 页数据...`);
            
            // 1. 获取当前页数据
            const rows = Array.from(document.querySelectorAll('tr.el-table__row'));
            const pageData = rows.map(row => extractRowData(row)).filter(Boolean);
            allRows.push(...pageData);
            console.log(`📋 当前页采集到 ${pageData.length} 条有效数据`);
            if (pageData.length > 0) {
              console.log('📝 示例数据:', JSON.stringify(pageData[0], null, 2));
            }
            // 2. 下一页按钮检测
            const nextBtn = document.querySelector('.btn-next');
            const isLastPage = nextBtn && nextBtn.hasAttribute('disabled');
            
            if (isLastPage) {
                console.log('🛑 已到达最后一页');
                break;
            }
            
            // 3. 执行翻页
            currentPage++;
            nextBtn.click();
            await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY));
        }
        
        console.log(`✅ 采集完成，共处理 ${currentPage} 页，获得 ${allRows.length} 条数据`);
        return allRows;
    }

    // ========== 文件生成函数 ==========
    async function generateZip(data) {
        return new Promise(async (resolve) => {
            console.log('🗜️ 开始生成压缩文件...');
            const zip = new JSZip();
            const salesMap = new Map();
            
            // 统计信息
            let matchedCount = 0;
            let unmatchedCount = 0;
            const uniqueKeys = new Set();
            const matchedKeys = new Set(); // 新增：记录已匹配的键

            // 1. 数据去重处理
            data.forEach(item => {
                if (!item.excelRow) {
                    unmatchedCount++;
                    return;
                }
                
                // 使用更可靠的键格式
                const key = `${item.webData.name}_${item.webData.id}`;
                if (uniqueKeys.has(key)) {
                    console.log(`⚠️ 发现重复数据: ${key}`);
                    return;
                }
                uniqueKeys.add(key);
                matchedKeys.add(key); // 记录已匹配的键
                matchedCount++;
                
                const salesman = item.webData.salesman.replace(/[/\\?%*:|"<>]/g, '_');
                if (!salesMap.has(salesman)) {
                    salesMap.set(salesman, []);
                }
                salesMap.get(salesman).push(item.excelRow);
            });
            
            console.log(`🔍 匹配结果: ${matchedCount}条匹配, ${unmatchedCount}条未匹配`);
            
            // 新增：打印前10条未匹配的Excel数据
            const unmatchedExcelKeys = [...allExcelKeys].filter(key => !matchedKeys.has(key));
            if (unmatchedExcelKeys.length > 0) {
                console.log("⚠️ 以下为前10条未匹配的Excel数据:");
                unmatchedExcelKeys.slice(0, 10).forEach(key => {
                    const row = excelMap.get(key);
                    if (row && row.length >= 2) {
                        console.log(`  - 姓名: ${row[0]}, 证件号: ${row[1]}`);
                    }
                });
                console.log(`⚠️ 共 ${unmatchedExcelKeys.length} 条Excel数据未匹配`);
            } else {
                console.log("✅ 所有Excel数据均已匹配");
            }

            let all = 0;
            // 2. 生成CSV文件
            salesMap.forEach((rows, salesman) => {
                const headerRow = '\uFEFF' + excelHeaders.join(',');
                const dataRows = rows.map(row => 
                    row.map(cell => 
                        typeof cell === 'string' ? `"${cell.replace(/"/g, '""')}"` : (cell ?? '')
                    ).join(',')
                ).join('\n');
                
                zip.file(`${salesman}.csv`, headerRow + '\n' + dataRows);
                console.log(`📄 生成文件: ${salesman}.csv (${rows.length}条)`);
                all += rows.length;
            });
            console.log(`总条数: ${all}`);


            // 3. 下载ZIP
            const blob = await zip.generateAsync({type: "blob"});
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${CONFIG.ZIP_PREFIX}_${new Date().toLocaleDateString('zh-CN')}.zip`;
            document.body.appendChild(link);
            link.click();
            
            // 4. 清理资源
            setTimeout(() => {
                document.body.removeChild(link);
                URL.revokeObjectURL(link.href);
                console.log('🧹 临时资源已清理');
                resolve();
            }, 100);
        });
    }

    // ========== 主执行流程 ==========
    try {
        console.log('🚀 启动数据采集任务');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const matchedData = await fetchAllPages();
        
        if (matchedData.length > 0) {
            console.log(`匹配数据条数: ${matchedData.length}`);
            await generateZip(matchedData);
            console.log('🎉 文件生成完成');
            alert('✅ 数据文件已生成并下载\n任务终止运行');
        } else {
            console.log('⚠️ 无匹配数据');
            alert('⚠️ 未找到匹配数据\n任务终止运行');
        }
    } catch (e) {
        console.error('❌ 处理失败:', e);
        alert(`❌ 处理失败: ${e.message}\n任务终止运行`);
    } finally {
        console.log('🔚 程序执行结束');
    }
})();