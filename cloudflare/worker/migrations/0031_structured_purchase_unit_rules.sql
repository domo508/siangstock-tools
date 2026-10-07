-- 將採購單位由自由文字比對改為供應商／品類／尺寸的結構化規則。
-- 「其它品項」把既有的隱含預設值改成前台可見規則：普優瑪1件、力榮10件。
UPDATE procurement_rules_current
SET version = version + 1,
    payload = json_set(
      payload,
      '$.purchaseUnits',
      json('[
        {"supplier":"普優瑪寢具有限公司","conditionMode":"structured","productCategory":"床包","sizeOption":"3.5尺","ruleName":"床包3.5尺","matchText":"床包|3.5尺","quantity":10,"enabled":true},
        {"supplier":"普優瑪寢具有限公司","conditionMode":"structured","productCategory":"床包","sizeOption":"5尺","ruleName":"床包5尺","matchText":"床包|5尺","quantity":20,"enabled":true},
        {"supplier":"普優瑪寢具有限公司","conditionMode":"structured","productCategory":"床包","sizeOption":"6尺","ruleName":"床包6尺","matchText":"床包|6尺","quantity":20,"enabled":true},
        {"supplier":"普優瑪寢具有限公司","conditionMode":"structured","productCategory":"床包","sizeOption":"7尺","ruleName":"床包7尺","matchText":"床包|7尺","quantity":10,"enabled":true},
        {"supplier":"普優瑪寢具有限公司","conditionMode":"structured","productCategory":"薄被套","sizeOption":"4.5×6.5尺","ruleName":"單人薄被套4.5×6.5尺","matchText":"單人薄被套","quantity":10,"enabled":true},
        {"supplier":"普優瑪寢具有限公司","conditionMode":"structured","productCategory":"薄被套","sizeOption":"6×7尺","ruleName":"雙人薄被套6×7尺","matchText":"雙人薄被套","quantity":20,"enabled":true},
        {"supplier":"普優瑪寢具有限公司","conditionMode":"structured","productCategory":"兩用被套","sizeOption":"4.5×6.5尺","ruleName":"單人兩用被套4.5×6.5尺","matchText":"單人兩用被套","quantity":10,"enabled":true},
        {"supplier":"普優瑪寢具有限公司","conditionMode":"structured","productCategory":"兩用被套","sizeOption":"6×7尺","ruleName":"雙人兩用被套6×7尺","matchText":"雙人兩用被套","quantity":10,"enabled":true},
        {"supplier":"普優瑪寢具有限公司","conditionMode":"structured","productCategory":"其它品項","sizeOption":"全部規格","ruleName":"其它品項","matchText":"","quantity":1,"enabled":true},
        {"supplier":"力榮","conditionMode":"structured","productCategory":"床包","sizeOption":"3.5尺","ruleName":"床包3.5尺","matchText":"床包|3.5尺","quantity":10,"enabled":true},
        {"supplier":"力榮","conditionMode":"structured","productCategory":"床包","sizeOption":"5尺","ruleName":"床包5尺","matchText":"床包|5尺","quantity":20,"enabled":true},
        {"supplier":"力榮","conditionMode":"structured","productCategory":"床包","sizeOption":"6尺","ruleName":"床包6尺","matchText":"床包|6尺","quantity":20,"enabled":true},
        {"supplier":"力榮","conditionMode":"structured","productCategory":"床包","sizeOption":"7尺","ruleName":"床包7尺","matchText":"床包|7尺","quantity":10,"enabled":true},
        {"supplier":"力榮","conditionMode":"structured","productCategory":"薄被套","sizeOption":"4.5×6.5尺","ruleName":"單人薄被套4.5×6.5尺","matchText":"單人薄被套","quantity":10,"enabled":true},
        {"supplier":"力榮","conditionMode":"structured","productCategory":"薄被套","sizeOption":"6×7尺","ruleName":"雙人薄被套6×7尺","matchText":"雙人薄被套","quantity":10,"enabled":true},
        {"supplier":"力榮","conditionMode":"structured","productCategory":"兩用被套","sizeOption":"4.5×6.5尺","ruleName":"單人兩用被套4.5×6.5尺","matchText":"單人兩用被套","quantity":10,"enabled":true},
        {"supplier":"力榮","conditionMode":"structured","productCategory":"兩用被套","sizeOption":"6×7尺","ruleName":"雙人兩用被套6×7尺","matchText":"雙人兩用被套","quantity":10,"enabled":true},
        {"supplier":"力榮","conditionMode":"structured","productCategory":"其它品項","sizeOption":"全部規格","ruleName":"其它品項","matchText":"","quantity":10,"enabled":true}
      ]')
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_by = 'system:migration-0031'
WHERE id = 1;

INSERT INTO procurement_rules_history (version, payload, change_reason, changed_at, changed_by)
SELECT version, payload, '採購單位改為供應商、品類及尺寸連動選項；力榮5尺與6尺床包正式套用20件', updated_at, updated_by
FROM procurement_rules_current WHERE id = 1;
