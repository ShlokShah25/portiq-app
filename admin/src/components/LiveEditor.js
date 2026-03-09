import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import './LiveEditor.css';

const LiveEditor = ({ config: propConfig, setConfig: setPropConfig }) => {
  const [config, setConfig] = useState(propConfig);
  const [loading, setLoading] = useState(!propConfig);
  const [saving, setSaving] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [elements, setElements] = useState([]);
  const [selectedElement, setSelectedElement] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeHandle, setResizeHandle] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [showCenterLines, setShowCenterLines] = useState({ vertical: false, horizontal: false });
  const [snapThreshold] = useState(1);
  const pageType = 'alwaysOn';
  const canvasRef = useRef(null);

  useEffect(() => {
    if (propConfig) {
      setConfig(propConfig);
      setLoading(false);
      const pageElements = propConfig.pageCustomization?.alwaysOn?.elements || [];
      setElements(pageElements);
    }
  }, [propConfig]);

  useEffect(() => {
    if (config) {
      const pageElements = config.pageCustomization?.alwaysOn?.elements || [];
      setElements(pageElements);
    }
  }, [config]);

  const templates = [
    {
      id: 'template1',
      name: 'Award Board – Student of the Week',
      elements: [
        { id: 'img1', type: 'image', x: 50, y: 35, width: 25, height: 30, src: '', zIndex: 1 },
        { id: 'text1', type: 'text', x: 50, y: 10, width: 85, height: 8, content: 'STUDENT OF THE WEEK', fontSize: 26, color: '#ffc107', zIndex: 2, textAlign: 'center', fontWeight: '700' },
        { id: 'text2', type: 'text', x: 50, y: 22, width: 80, height: 7, content: 'Student Name', fontSize: 30, color: '#ffffff', zIndex: 2, textAlign: 'center', fontWeight: '600' },
        { id: 'text3', type: 'text', x: 50, y: 32, width: 60, height: 5, content: 'Class · House', fontSize: 18, color: '#e0e7ff', zIndex: 2, textAlign: 'center' },
        { id: 'text4', type: 'text', x: 50, y: 70, width: 85, height: 10, content: 'For outstanding achievement in academic sports / arts.', fontSize: 16, color: '#c7d2fe', zIndex: 2, textAlign: 'center', opacity: 0.9 },
        { id: 'text5', type: 'text', x: 50, y: 85, width: 60, height: 5, content: 'Week of 10-17 March', fontSize: 14, color: '#a5b4fc', zIndex: 2, textAlign: 'center', opacity: 0.8 }
      ]
    },
    {
      id: 'template2',
      name: 'House Points Leaderboard',
      elements: [
        { id: 'text1', type: 'text', x: 50, y: 12, width: 85, height: 8, content: 'HOUSE POINTS', fontSize: 32, color: '#ffffff', zIndex: 2, textAlign: 'center', fontWeight: '700' },
        { id: 'text2', type: 'text', x: 50, y: 28, width: 70, height: 7, content: 'House 1: 2450 pts', fontSize: 22, color: '#4fc3f7', zIndex: 2, textAlign: 'center', fontWeight: '600' },
        { id: 'text3', type: 'text', x: 50, y: 38, width: 70, height: 7, content: 'House 2: 2380 pts', fontSize: 22, color: '#4fc3f7', zIndex: 2, textAlign: 'center', fontWeight: '600' },
        { id: 'text4', type: 'text', x: 50, y: 48, width: 70, height: 7, content: 'House 3: 2210 pts', fontSize: 22, color: '#4fc3f7', zIndex: 2, textAlign: 'center', fontWeight: '600' },
        { id: 'text5', type: 'text', x: 50, y: 58, width: 70, height: 7, content: 'House 4: 2150 pts', fontSize: 22, color: '#4fc3f7', zIndex: 2, textAlign: 'center', fontWeight: '600' }
      ]
    },
    {
      id: 'template3',
      name: 'Quote of the Day + Photo',
      elements: [
        { id: 'img1', type: 'image', x: 50, y: 30, width: 22, height: 35, src: '', zIndex: 1 },
        { id: 'text1', type: 'text', x: 50, y: 12, width: 85, height: 12, content: '"Education is the most powerful weapon which you can use to change the world."', fontSize: 22, color: '#ffffff', zIndex: 2, textAlign: 'center', fontStyle: 'italic' },
        { id: 'text2', type: 'text', x: 50, y: 70, width: 60, height: 6, content: '— Nelson Mandela', fontSize: 18, color: '#e0e7ff', zIndex: 2, textAlign: 'center' }
      ]
    },
    {
      id: 'template4',
      name: 'Notice Board – Upcoming Event',
      elements: [
        { id: 'text1', type: 'text', x: 50, y: 15, width: 85, height: 8, content: 'UPCOMING EVENT', fontSize: 28, color: '#ffc107', zIndex: 2, textAlign: 'center', fontWeight: '700' },
        { id: 'text2', type: 'text', x: 50, y: 28, width: 80, height: 9, content: 'Annual Sports Day', fontSize: 32, color: '#ffffff', zIndex: 2, textAlign: 'center', fontWeight: '600' },
        { id: 'text3', type: 'text', x: 50, y: 45, width: 75, height: 6, content: 'Date: 25th March 2024', fontSize: 20, color: '#e0e7ff', zIndex: 2, textAlign: 'center' },
        { id: 'text4', type: 'text', x: 50, y: 54, width: 75, height: 6, content: 'Venue: School Grounds', fontSize: 20, color: '#e0e7ff', zIndex: 2, textAlign: 'center' },
        { id: 'text5', type: 'text', x: 50, y: 63, width: 75, height: 6, content: 'Time: 8:00 AM - 4:00 PM', fontSize: 20, color: '#e0e7ff', zIndex: 2, textAlign: 'center' }
      ]
    },
    {
      id: 'template5',
      name: 'Awards – 3 Spotlights',
      elements: [
        { id: 'img1', type: 'image', x: 25, y: 28, width: 16, height: 22, src: '', zIndex: 1 },
        { id: 'img2', type: 'image', x: 50, y: 28, width: 16, height: 22, src: '', zIndex: 1 },
        { id: 'img3', type: 'image', x: 75, y: 28, width: 16, height: 22, src: '', zIndex: 1 },
        { id: 'text1', type: 'text', x: 25, y: 55, width: 16, height: 5, content: 'Academic', fontSize: 13, color: '#ffffff', zIndex: 2, textAlign: 'center' },
        { id: 'text2', type: 'text', x: 50, y: 55, width: 16, height: 5, content: 'Sports', fontSize: 13, color: '#ffffff', zIndex: 2, textAlign: 'center' },
        { id: 'text3', type: 'text', x: 75, y: 55, width: 16, height: 5, content: 'Cultural', fontSize: 13, color: '#ffffff', zIndex: 2, textAlign: 'center' }
      ]
    }
  ];

  const handleMouseDown = (e, element) => {
    // Don't prevent default on the outer element - let it bubble naturally
    // Only prevent if clicking on controls
    if (e.target.closest('.element-controls') || e.target.closest('.resize-handle')) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    
    // Check if clicking on a resize handle
    const handle = e.target.dataset.handle;
    if (handle) {
      e.preventDefault();
      e.stopPropagation();
      setSelectedElement(element);
      setIsResizing(true);
      setResizeHandle(handle);
      return;
    }
    
    // Get the current element from the elements array to ensure we have the latest position
    const currentElement = elements.find(el => el.id === element.id) || element;
    
    // Set selected element with current position to prevent jumps
    setSelectedElement({ ...currentElement });
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      console.error('Canvas ref not available');
      return;
    }
    
    const isCentered = currentElement.textAlign === 'center' || currentElement.id?.includes('welcome') || currentElement.id?.includes('school') || currentElement.id?.includes('subtitle') || currentElement.id === 'welcome_logo';
    
    // Calculate click position relative to canvas
    const clickX = ((e.clientX - rect.left) / rect.width) * 100;
    const clickY = ((e.clientY - rect.top) / rect.height) * 100;
    
    // For centered elements, the stored x is the center point (50% for center)
    // The element is positioned at x% and then translated -50% to center it
    // So when clicking, we need to calculate offset from the center point
    let offsetX, offsetY;
    
    if (isCentered) {
      // For centered elements, x is the center point
      // Click position relative to the center of the element
      offsetX = clickX - currentElement.x;
      offsetY = clickY - currentElement.y;
    } else {
      // For non-centered elements, x is the left edge
      offsetX = clickX - currentElement.x;
      offsetY = clickY - currentElement.y;
    }
    
    setDragOffset({
      x: offsetX,
      y: offsetY
    });
    
    // Start dragging immediately
    setIsDragging(true);
  };

  const handleMouseMove = useCallback((e) => {
    if (!canvasRef.current || !selectedElement) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    
    if (isResizing && resizeHandle) {
      // Handle resizing
      const mouseX = ((e.clientX - rect.left) / rect.width) * 100;
      const mouseY = ((e.clientY - rect.top) / rect.height) * 100;
      
      // Get current element state from elements array
      setElements(prev => {
        const currentEl = prev.find(el => el.id === selectedElement.id);
        if (!currentEl) return prev;
        
        const startX = currentEl.x;
        const startY = currentEl.y;
        const startWidth = currentEl.width;
        const startHeight = currentEl.height;
        
        let newX = startX;
        let newY = startY;
        let newWidth = startWidth;
        let newHeight = startHeight;
      
      // Calculate resize based on handle
      if (resizeHandle === 'e') { // East (right edge)
        newWidth = Math.max(5, Math.min(100 - startX, mouseX - startX));
      } else if (resizeHandle === 'w') { // West (left edge)
        const diff = startX - mouseX;
        newX = Math.max(0, mouseX);
        newWidth = Math.max(5, Math.min(100 - newX, startWidth + diff));
      } else if (resizeHandle === 's') { // South (bottom edge)
        newHeight = Math.max(3, Math.min(100 - startY, mouseY - startY));
      } else if (resizeHandle === 'n') { // North (top edge)
        const diff = startY - mouseY;
        newY = Math.max(0, mouseY);
        newHeight = Math.max(3, Math.min(100 - newY, startHeight + diff));
      } else if (resizeHandle === 'se') { // Southeast (bottom-right corner)
        newWidth = Math.max(5, Math.min(100 - startX, mouseX - startX));
        newHeight = Math.max(3, Math.min(100 - startY, mouseY - startY));
      } else if (resizeHandle === 'sw') { // Southwest (bottom-left corner)
        const diff = startX - mouseX;
        newX = Math.max(0, mouseX);
        newWidth = Math.max(5, Math.min(100 - newX, startWidth + diff));
        newHeight = Math.max(3, Math.min(100 - startY, mouseY - startY));
      } else if (resizeHandle === 'ne') { // Northeast (top-right corner)
        newWidth = Math.max(5, Math.min(100 - startX, mouseX - startX));
        const diff = startY - mouseY;
        newY = Math.max(0, mouseY);
        newHeight = Math.max(3, Math.min(100 - newY, startHeight + diff));
      } else if (resizeHandle === 'nw') { // Northwest (top-left corner)
        const diffX = startX - mouseX;
        const diffY = startY - mouseY;
        newX = Math.max(0, mouseX);
        newY = Math.max(0, mouseY);
        newWidth = Math.max(5, Math.min(100 - newX, startWidth + diffX));
        newHeight = Math.max(3, Math.min(100 - newY, startHeight + diffY));
      }
      
        // Ensure element stays within bounds
        if (newX + newWidth > 100) {
          newWidth = 100 - newX;
        }
        if (newY + newHeight > 100) {
          newHeight = 100 - newY;
        }
        
        const updatedEl = { ...currentEl, x: newX, y: newY, width: newWidth, height: newHeight };
        
        // Update selectedElement to reflect new size
        setSelectedElement(updatedEl);
        
        return prev.map(el => 
          el.id === selectedElement.id ? updatedEl : el
        );
      });
    } else if (isDragging && selectedElement) {
      // Handle dragging with snap-to-center
      const isCentered = selectedElement.textAlign === 'center' || selectedElement.id?.includes('welcome') || selectedElement.id?.includes('school') || selectedElement.id?.includes('subtitle') || selectedElement.id === 'welcome_logo';
      
      // Calculate new position based on mouse position and drag offset
      let x = ((e.clientX - rect.left) / rect.width) * 100 - dragOffset.x;
      let y = ((e.clientY - rect.top) / rect.height) * 100 - dragOffset.y;
      
      // Calculate bounds based on whether element is centered
      let minX, maxX, minY, maxY;
      
      if (isCentered) {
        // For centered elements, x represents the center point
        // So bounds are: half width from 0 to half width from 100
        minX = selectedElement.width / 2;
        maxX = 100 - (selectedElement.width / 2);
        minY = 0;
        maxY = 100 - selectedElement.height;
      } else {
        // For non-centered elements, x is the left edge
        minX = 0;
        maxX = 100 - selectedElement.width;
        minY = 0;
        maxY = 100 - selectedElement.height;
      }
      
      // Calculate center position for snapping
      const centerX = isCentered ? 50 : (50 - (selectedElement.width / 2));
      const centerY = 50 - (selectedElement.height / 2);
      
      // Check if near center and snap
      const nearCenterX = Math.abs(x - centerX) < snapThreshold;
      const nearCenterY = Math.abs(y - centerY) < snapThreshold;
      
      if (nearCenterX) {
        x = centerX;
        setShowCenterLines(prev => ({ ...prev, vertical: true }));
      } else {
        setShowCenterLines(prev => ({ ...prev, vertical: false }));
      }
      
      if (nearCenterY) {
        y = centerY;
        setShowCenterLines(prev => ({ ...prev, horizontal: true }));
      } else {
        setShowCenterLines(prev => ({ ...prev, horizontal: false }));
      }
      
      // Constrain to bounds
      x = Math.max(minX, Math.min(maxX, x));
      y = Math.max(minY, Math.min(maxY, y));
      
      // Update both elements array and selectedElement to keep them in sync
      setElements(prev => prev.map(el => 
        el.id === selectedElement.id ? { ...el, x, y } : el
      ));
      
      // Update selectedElement to prevent jumps
      setSelectedElement(prev => prev && prev.id === selectedElement.id ? { ...prev, x, y } : prev);
    }
  }, [isDragging, isResizing, resizeHandle, selectedElement, dragOffset]);

  const handleMouseUp = useCallback(() => {
    if (isDragging || isResizing) {
      setIsDragging(false);
      setIsResizing(false);
      setResizeHandle(null);
      setShowCenterLines({ vertical: false, horizontal: false });
    }
  }, [isDragging, isResizing]);

  useEffect(() => {
    if (isDragging || isResizing) {
      const handleMove = (e) => {
        e.preventDefault();
        handleMouseMove(e);
      };
      const handleUp = () => {
        handleMouseUp();
      };
      
      document.addEventListener('mousemove', handleMove, { passive: false });
      document.addEventListener('mouseup', handleUp, { passive: true });
      document.body.style.cursor = isDragging ? 'grabbing' : 'default';
      document.body.style.userSelect = 'none';
      
      return () => {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

  const addElement = (type) => {
    const newElement = {
      id: `${type}_${Date.now()}`,
      type,
      x: 50,
      y: 50,
      width: type === 'image' ? 20 : 30,
      height: type === 'image' ? 20 : 10,
      ...(type === 'text' ? { content: 'New Text', fontSize: 24, color: '#ffffff', textAlign: 'center' } : {}),
      ...(type === 'image' ? { src: '' } : {}),
      zIndex: elements.length + 1
    };
    setElements([...elements, newElement]);
    setSelectedElement(newElement);
  };

  const updateElement = (id, updates) => {
    setElements(prev => prev.map(el => {
      if (el.id !== id) return el;
      const updated = { ...el, ...updates };
      if (updated.width !== undefined) {
        const maxWidth = 100 - updated.x;
        updated.width = Math.max(5, Math.min(maxWidth, updated.width));
      }
      if (updated.height !== undefined) {
        const maxHeight = 100 - updated.y;
        updated.height = Math.max(3, Math.min(maxHeight, updated.height));
      }
      const maxX = 100 - updated.width;
      const maxY = 100 - updated.height;
      updated.x = Math.max(0, Math.min(maxX, updated.x));
      updated.y = Math.max(0, Math.min(maxY, updated.y));
      return updated;
    }));
  };

  const deleteElement = (id) => {
    setElements(prev => prev.filter(el => el.id !== id));
    if (selectedElement?.id === id) setSelectedElement(null);
  };

  const applyTemplate = (template) => {
    setElements(template.elements.map(el => ({ ...el, id: `${el.id}_${Date.now()}` })));
    setSelectedElement(null);
    setTemplatesOpen(false);
  };

  const handleImageUpload = (e, elementId) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      updateElement(elementId, { src: event.target.result });
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const dataToSave = {
        ...config,
        pageCustomization: {
          ...config.pageCustomization,
          alwaysOn: { elements }
        }
      };
      await axios.put('/config', {
        pageCustomization: dataToSave.pageCustomization,
        alwaysOnDisplay: dataToSave.alwaysOnDisplay
      });
      setConfig(dataToSave);
      if (setPropConfig) setPropConfig(dataToSave);
      alert('Layout saved successfully!');
    } catch (error) {
      console.error('Error saving:', error);
      alert('Error saving layout: ' + (error.response?.data?.error || error.message));
    } finally {
      setSaving(false);
    }
  };

  const saveTemplate = () => {
    if (!templateName.trim()) {
      alert('Please enter a template name');
      return;
    }
    const savedTemplates = JSON.parse(localStorage.getItem('savedTemplates_alwaysOn') || '[]');
    const newTemplate = {
      id: `custom_${Date.now()}`,
      name: templateName.trim(),
      elements: elements.map(el => ({ ...el }))
    };
    savedTemplates.push(newTemplate);
    localStorage.setItem('savedTemplates_alwaysOn', JSON.stringify(savedTemplates));
    setShowSaveTemplateModal(false);
    setTemplateName('');
    alert(`Template "${templateName}" saved successfully!`);
  };

  const getSavedTemplates = () => {
    try {
      return JSON.parse(localStorage.getItem('savedTemplates_alwaysOn') || '[]');
    } catch {
      return [];
    }
  };

  if (loading || !config) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Loading editor...</div>;
  }

  // Create a modified config with current elements for preview
  const previewConfig = {
    ...config,
    pageCustomization: {
      ...config.pageCustomization,
      alwaysOn: { elements }
    }
  };

  return (
    <div className="live-editor">
      {/* Toggle Sidebar Button */}
      <button 
        className="sidebar-toggle"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        style={{ left: sidebarOpen ? '320px' : '0' }}
      >
        {sidebarOpen ? '◀' : '▶'}
      </button>

      {/* Editor Sidebar */}
      <div className={`editor-sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <h2>Live Editor</h2>
          <button onClick={() => navigate('/config')} className="close-btn">✕</button>
        </div>

            <div className="sidebar-content">
          <div className="editor-controls">
            <div className="control-section">
              <h3>Templates</h3>
              <div className="templates-dropdown-container">
                <button className="templates-toggle-btn" onClick={() => setTemplatesOpen(!templatesOpen)}>
                  Templates <span>▼</span>
                </button>
                {templatesOpen && (
                  <div className="templates-dropdown">
                    <div className="templates-section">
                      <div className="templates-section-title">Built-in</div>
                      {templates.map(template => (
                        <button
                          key={template.id}
                          className="template-btn"
                          onClick={() => { applyTemplate(template); setTemplatesOpen(false); }}
                        >
                          {template.name}
                        </button>
                      ))}
                    </div>
                    {getSavedTemplates().length > 0 && (
                      <div className="templates-section">
                        <div className="templates-section-title">Saved</div>
                        {getSavedTemplates().map(template => (
                          <button
                            key={template.id}
                            className="template-btn saved"
                            onClick={() => { applyTemplate(template); setTemplatesOpen(false); }}
                          >
                            {template.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="control-section">
              <h3>Add Elements</h3>
              <div className="add-elements-group">
                <button className="add-btn" onClick={() => addElement('text')}>+ Text</button>
                <button className="add-btn" onClick={() => addElement('image')}>+ Image</button>
              </div>
            </div>

            {selectedElement && (
              <div className="control-section properties-panel">
                <h3>Properties</h3>
                {selectedElement.type === 'text' && (
                  <>
                    <div className="prop-group">
                      <label>Content</label>
                      <textarea
                        value={selectedElement.content || ''}
                        onChange={(e) => {
                          const newContent = e.target.value;
                          setElements(prev => prev.map(el => 
                            el.id === selectedElement.id ? { ...el, content: newContent } : el
                          ));
                          setSelectedElement(prev => prev ? { ...prev, content: newContent } : null);
                        }}
                        rows="3"
                      />
                    </div>
                    <div className="prop-group">
                      <label>Font Size</label>
                      <input
                        type="number"
                        value={selectedElement.fontSize || 24}
                        onChange={(e) => updateElement(selectedElement.id, { fontSize: parseInt(e.target.value) })}
                      />
                    </div>
                    <div className="prop-group">
                      <label>Color</label>
                      <input
                        type="color"
                        value={selectedElement.color || '#ffffff'}
                        onChange={(e) => updateElement(selectedElement.id, { color: e.target.value })}
                      />
                    </div>
                  </>
                )}
                {selectedElement.type === 'image' && (
                  <div className="prop-group">
                    <label>Upload Image</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleImageUpload(e, selectedElement.id)}
                    />
                  </div>
                )}
                <div className="prop-group">
                  <label>Position X: {selectedElement.x.toFixed(1)}%</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="0.1"
                    value={selectedElement.x}
                    onChange={(e) => updateElement(selectedElement.id, { x: parseFloat(e.target.value) })}
                  />
                </div>
                <div className="prop-group">
                  <label>Position Y: {selectedElement.y.toFixed(1)}%</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="0.1"
                    value={selectedElement.y}
                    onChange={(e) => updateElement(selectedElement.id, { y: parseFloat(e.target.value) })}
                  />
                </div>
                <div className="prop-group">
                  <label>Width: {selectedElement.width.toFixed(1)}%</label>
                  <input
                    type="range"
                    min="5"
                    max="100"
                    step="0.1"
                    value={selectedElement.width}
                    onChange={(e) => updateElement(selectedElement.id, { width: parseFloat(e.target.value) })}
                  />
                </div>
                <div className="prop-group">
                  <label>Height: {selectedElement.height.toFixed(1)}%</label>
                  <input
                    type="range"
                    min="3"
                    max="100"
                    step="0.1"
                    value={selectedElement.height}
                    onChange={(e) => updateElement(selectedElement.id, { height: parseFloat(e.target.value) })}
                  />
                </div>
                <button className="delete-btn" onClick={() => deleteElement(selectedElement.id)}>Delete Element</button>
              </div>
            )}

            <div className="control-section">
              <button className="save-btn" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : '💾 Save Layout'}
              </button>
              <button className="save-template-btn" onClick={() => setShowSaveTemplateModal(true)}>
                💾 Save Template As
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Kiosk Display Preview */}
      <div className="kiosk-preview" ref={canvasRef}>
        {/* Center Guide Lines */}
        {(showCenterLines.vertical || showCenterLines.horizontal) && (
          <div className="center-guide-lines">
            {showCenterLines.vertical && (
              <div 
                className="guide-line guide-line-vertical"
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: 0,
                  bottom: 0,
                  width: '2px',
                  background: 'rgba(79, 195, 247, 0.8)',
                  zIndex: 9999,
                  pointerEvents: 'none',
                  boxShadow: '0 0 8px rgba(79, 195, 247, 0.6)',
                  animation: 'pulse 1.5s ease-in-out infinite'
                }}
              />
            )}
            {showCenterLines.horizontal && (
              <div 
                className="guide-line guide-line-horizontal"
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: 0,
                  right: 0,
                  height: '2px',
                  background: 'rgba(79, 195, 247, 0.8)',
                  zIndex: 9999,
                  pointerEvents: 'none',
                  boxShadow: '0 0 8px rgba(79, 195, 247, 0.6)',
                  animation: 'pulse 1.5s ease-in-out infinite'
                }}
              />
            )}
          </div>
        )}
        <div 
          className="always-on-display"
          style={{
            backgroundColor: config.alwaysOnDisplay?.backgroundColor || '#0a1929',
            color: config.alwaysOnDisplay?.textColor || '#ffffff'
          }}
        >
          <div className="display-content">
            {elements.map((element, idx) => {
              const isCentered = element.textAlign === 'center' || element.id?.includes('welcome') || element.id?.includes('school') || element.id?.includes('subtitle') || element.id === 'welcome_logo';
              
              return (
                <div
                  key={element.id || idx}
                  className={`custom-element ${selectedElement?.id === element.id ? 'selected' : ''} ${isDragging && selectedElement?.id === element.id ? 'dragging' : ''}`}
                  style={{
                    position: 'absolute',
                    left: `${element.x}%`,
                    top: `${element.y}%`,
                    width: `${element.width}%`,
                    height: `${element.height}%`,
                    zIndex: (selectedElement?.id === element.id) ? 1000 : (element.zIndex || 1),
                    transition: (isDragging && selectedElement?.id === element.id) ? 'none' : 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
                    transform: isCentered ? 'translateX(-50%)' : 'none',
                    border: selectedElement?.id === element.id ? '2px solid #4fc3f7' : '2px solid transparent',
                    boxShadow: selectedElement?.id === element.id ? '0 0 0 4px rgba(79, 195, 247, 0.2)' : 'none',
                    cursor: (isDragging && selectedElement?.id === element.id) ? 'grabbing' : 'move',
                    willChange: (isDragging && selectedElement?.id === element.id) ? 'transform, left, top' : 'auto',
                    pointerEvents: 'all',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    touchAction: 'none'
                  }}
                  onMouseDown={(e) => {
                    handleMouseDown(e, element);
                  }}
                >
                  {element.type === 'text' && (
                    <div
                      style={{
                        fontSize: `${element.fontSize || 24}px`,
                        color: element.color || config.alwaysOnDisplay?.textColor || '#ffffff',
                        textAlign: element.textAlign || 'left',
                        fontWeight: element.fontWeight || 'normal',
                        fontStyle: element.fontStyle || 'normal',
                        opacity: element.opacity || 1,
                        letterSpacing: element.letterSpacing || 'normal',
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: element.textAlign === 'center' ? 'center' : 
                                        element.textAlign === 'right' ? 'flex-end' : 'flex-start',
                        padding: '8px',
                        textShadow: element.id === 'school_name' ? '0 4px 20px rgba(0, 0, 0, 0.5)' : '0 2px 10px rgba(0, 0, 0, 0.3)',
                        pointerEvents: 'none',
                        userSelect: 'none',
                        WebkitUserSelect: 'none'
                      }}
                    >
                      {element.content}
                    </div>
                  )}
                  
                  {element.type === 'image' && element.src && (
                    <img 
                      src={element.src} 
                      alt="Display" 
                      style={{ 
                        width: '100%', 
                        height: '100%', 
                        objectFit: 'contain',
                        filter: element.id === 'welcome_logo' ? 'drop-shadow(0 8px 32px rgba(0, 0, 0, 0.4)) drop-shadow(0 0 40px rgba(79, 195, 247, 0.2))' : 'none',
                        animation: element.id === 'welcome_logo' ? 'logoGlow 3s ease-in-out infinite' : 'none',
                        pointerEvents: 'none'
                      }}
                    />
                  )}

                  {selectedElement?.id === element.id && (
                    <>
                      <div className="element-controls-overlay">
                        <button onClick={() => deleteElement(element.id)}>×</button>
                      </div>
                      {/* Resize handles for images */}
                      {element.type === 'image' && (
                        <>
                          <div 
                            className="resize-handle" 
                            data-handle="nw" 
                            style={{ top: '-6px', left: '-6px', cursor: 'nw-resize' }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              setSelectedElement(element);
                              setIsResizing(true);
                              setResizeHandle('nw');
                            }}
                          ></div>
                          <div 
                            className="resize-handle" 
                            data-handle="ne" 
                            style={{ top: '-6px', right: '-6px', cursor: 'ne-resize' }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              setSelectedElement(element);
                              setIsResizing(true);
                              setResizeHandle('ne');
                            }}
                          ></div>
                          <div 
                            className="resize-handle" 
                            data-handle="sw" 
                            style={{ bottom: '-6px', left: '-6px', cursor: 'sw-resize' }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              setSelectedElement(element);
                              setIsResizing(true);
                              setResizeHandle('sw');
                            }}
                          ></div>
                          <div 
                            className="resize-handle" 
                            data-handle="se" 
                            style={{ bottom: '-6px', right: '-6px', cursor: 'se-resize' }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              setSelectedElement(element);
                              setIsResizing(true);
                              setResizeHandle('se');
                            }}
                          ></div>
                          <div 
                            className="resize-handle" 
                            data-handle="n" 
                            style={{ top: '-6px', left: '50%', transform: 'translateX(-50%)', cursor: 'n-resize' }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              setSelectedElement(element);
                              setIsResizing(true);
                              setResizeHandle('n');
                            }}
                          ></div>
                          <div 
                            className="resize-handle" 
                            data-handle="s" 
                            style={{ bottom: '-6px', left: '50%', transform: 'translateX(-50%)', cursor: 's-resize' }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              setSelectedElement(element);
                              setIsResizing(true);
                              setResizeHandle('s');
                            }}
                          ></div>
                          <div 
                            className="resize-handle" 
                            data-handle="e" 
                            style={{ right: '-6px', top: '50%', transform: 'translateY(-50%)', cursor: 'e-resize' }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              setSelectedElement(element);
                              setIsResizing(true);
                              setResizeHandle('e');
                            }}
                          ></div>
                          <div 
                            className="resize-handle" 
                            data-handle="w" 
                            style={{ left: '-6px', top: '50%', transform: 'translateY(-50%)', cursor: 'w-resize' }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              setSelectedElement(element);
                              setIsResizing(true);
                              setResizeHandle('w');
                            }}
                          ></div>
                        </>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div className="action-buttons">
            <button 
              className="action-btn"
              style={{
                backgroundColor: config.alwaysOnDisplay?.accentColor || '#4fc3f7',
                pointerEvents: 'none',
                opacity: 0.7
              }}
            >
              Tap here to continue
            </button>
          </div>

          <div className="touch-hint">
            <p>Tap the button below to continue</p>
          </div>
        </div>
      </div>

      {/* Save Template Modal */}
      {showSaveTemplateModal && (
        <div className="modal-overlay" onClick={() => setShowSaveTemplateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Save Template</h3>
            <div className="modal-form">
              <label>Template Name</label>
              <input
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g., Welcome Screen v2"
                autoFocus
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    saveTemplate();
                  }
                }}
              />
            </div>
            <div className="modal-actions">
              <button onClick={() => { setShowSaveTemplateModal(false); setTemplateName(''); }}>Cancel</button>
              <button onClick={saveTemplate} disabled={!templateName.trim()}>Save Template</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveEditor;
