const fs = require('fs')
const path = require('path')
const { validateServerConfig } = require('../../commands/sws/sub_commands/utility/check_config')
const config = require('../../commands/sws/sub_commands/utility/registry')

describe('validateServerConfig', () => {
    const fixturesDir = path.join(__dirname, '../fixtures')

    const testCases = [
        { file: 'valid_config.xml', shouldPass: true, description: 'Valid configuration file' },
        { file: 'missing_root.xml', shouldPass: false, description: 'Missing <server_data> root element' },
        { file: 'invalid_attribute.xml', shouldPass: false, description: 'Invalid attribute in <server_data>' },
        { file: 'missing_required_child.xml', shouldPass: false, description: 'Missing required child element' },
        { file: 'invalid_path.xml', shouldPass: false, description: 'Invalid path in <playlists>' },
        { file: 'invalid_mods.xml', shouldPass: false, description: 'Invalid mods structure' },
        { file: 'empty_file.xml', shouldPass: false, description: 'Empty XML file' },
        { file: 'malformed_xml.xml', shouldPass: false, description: 'Malformed XML file' },
        { file: 'unknown_element.xml', shouldPass: false, description: 'Unknown element in <server_data>' },
        { file: 'valid_with_optional.xml', shouldPass: true, description: 'Valid configuration with optional elements' },
    ]

    const additionalTestCases = [
        { file: 'multiple_root_elements.xml', shouldPass: false, description: 'Multiple <server_data> root elements' },
        { file: 'invalid_attribute_type.xml', shouldPass: false, description: 'Invalid attribute type in <server_data>' },
        { file: 'missing_required_attribute.xml', shouldPass: false, description: 'Missing required attribute in <server_data>' },
        { file: 'multiple_invalid_paths.xml', shouldPass: false, description: 'Multiple invalid paths in <playlists>' },
        { file: 'mixed_invalid_mods.xml', shouldPass: false, description: 'Mixed invalid <path> and <published_id> in <mods>' },
        { file: 'unexpected_child_order.xml', shouldPass: false, description: 'Unexpected child element order in <server_data>' },
        { file: 'duplicate_children.xml', shouldPass: false, description: 'Duplicate child elements in <server_data>' },
        { file: 'empty_attribute.xml', shouldPass: false, description: 'Empty attribute value in <server_data>' },
        { file: 'invalid_workshop_id_path.xml', shouldPass: false, description: 'Invalid workshop ID path in <playlists>' },
        { file: 'nonexistent_mod_path.xml', shouldPass: false, description: 'Nonexistent file path in <mods>' },
        { file: 'out_of_range_attribute.xml', shouldPass: false, description: 'Out of range attribute value in <server_data>' },
        { file: 'unknown_attribute.xml', shouldPass: false, description: 'Unknown attribute in <server_data>' },
        { file: 'empty_child_element.xml', shouldPass: false, description: 'Empty child element in <server_data>' },
        { file: 'invalid_child_attribute.xml', shouldPass: false, description: 'Invalid attribute in child element of <server_data>' },
        { file: 'invalid_mod_structure.xml', shouldPass: false, description: 'Invalid XML structure in <mods>' },
        { file: 'empty_playlist_path.xml', shouldPass: false, description: 'Empty <path> tag in <playlists>' },
        { file: 'duplicate_attribute_values.xml', shouldPass: false, description: 'Duplicate attribute values in <server_data>' },
        { file: 'invalid_child_value_type.xml', shouldPass: false, description: 'Invalid value type in child element of <server_data>' },
        { file: 'malformed_attribute_format.xml', shouldPass: false, description: 'Malformed attribute format in <server_data>' },
        { file: 'unauthorized_child_element.xml', shouldPass: false, description: 'Unauthorized child element in <server_data>' },
        { file: 'missing_mods_and_playlists.xml', shouldPass: false, description: 'Missing both <mods> and <playlists>' },
        { file: 'invalid_numeric_value.xml', shouldPass: false, description: 'Invalid numeric value in attributes' },
        { file: 'invalid_boolean_value.xml', shouldPass: false, description: 'Invalid boolean value in attributes' },
        { file: 'invalid_date_format.xml', shouldPass: false, description: 'Invalid date format in attributes' },
        { file: 'invalid_enum_value.xml', shouldPass: false, description: 'Invalid enum value in attributes' },
        { file: 'missing_required_child_in_mods.xml', shouldPass: false, description: 'Missing required child in <mods>' },
        { file: 'invalid_path_format.xml', shouldPass: false, description: 'Invalid path format in <playlists>' },
        { file: 'invalid_xml_namespace.xml', shouldPass: false, description: 'Invalid XML namespace declaration' },
        { file: 'invalid_encoding.xml', shouldPass: false, description: 'Invalid XML encoding declaration' },
        { file: 'invalid_special_characters.xml', shouldPass: false, description: 'Invalid special characters in attributes' },
        { file: 'invalid_nested_elements.xml', shouldPass: false, description: 'Invalid nested elements in <server_data>' },
        { file: 'invalid_empty_mods.xml', shouldPass: false, description: 'Empty <mods> element' },
        { file: 'invalid_empty_playlists.xml', shouldPass: false, description: 'Empty <playlists> element' },
        { file: 'invalid_duplicate_mods.xml', shouldPass: false, description: 'Duplicate <mods> elements' },
        { file: 'invalid_duplicate_playlists.xml', shouldPass: false, description: 'Duplicate <playlists> elements' },
        { file: 'invalid_empty_server_data.xml', shouldPass: false, description: 'Empty <server_data> element' },
        { file: 'invalid_large_file.xml', shouldPass: false, description: 'Excessively large XML file' },
        { file: 'invalid_unexpected_element.xml', shouldPass: false, description: 'Unexpected element in <server_data>' },
        { file: 'invalid_unexpected_attribute.xml', shouldPass: false, description: 'Unexpected attribute in <server_data>' },
    ]

    [...testCases, ...additionalTestCases].forEach(({ file, shouldPass, description }) => {
        it(`should ${shouldPass ? 'pass' : 'fail'} validation for ${description}`, async () => {
            const filePath = path.join(fixturesDir, file)
            const xmlContent = fs.readFileSync(filePath, 'utf-8')

            const result = await validateServerConfig(xmlContent)

            if (shouldPass) {
                expect(result.success).toBe(true)
                expect(result.errors.length).toBe(0)
            } else {
                expect(result.success).toBe(false)
                expect(result.errors.length).toBeGreaterThan(0)
            }
        })
    })
})